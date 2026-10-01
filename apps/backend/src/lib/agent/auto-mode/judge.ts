// Auto Mode LLM authorization judge — the Bedrock side-call.
//
// Mirrors stop-gate-judge.ts, but the FAIL DIRECTION is reversed: this is a
// security gate, so on timeout/error/unparseable output it returns null, and
// the decision engine treats null as "require authorization" (fail-safe /
// fail-closed). Pure prompt+parse live in judge-core.ts so tests load without
// @/config.
import { generateText } from 'ai'

import { config } from '@/config'
import { traced } from '@/lib/agent/braintrust'
import { newModelCallId, recordSideCallTokenUsage } from '@/lib/agent/token-usage-side-call'
import { logError } from '@/lib/observability'

import { getModel } from '../model-provider'

import { buildJudgePrompt, judgeSystemPrompt, parseJudgeResponse } from './judge-core'

import type { CommandAnalysis } from './command-analysis'
import type { Judge, JudgeResult } from './decision'
import type { AutoModePolicy } from './types'

export type RunJudgeContext = { userId?: string; sessionId?: string; teamId?: string }

/**
 * Runs the authorization judge. Returns null (→ caller requires auth) on
 * timeout, provider error, or an unparseable reply.
 */
export async function runAuthJudge(
  input: {
    command: string
    analysis: CommandAnalysis
    policy: AutoModePolicy
    sessionCommands?: string[]
    sessionApprovals?: string[]
  },
  ctx?: RunJudgeContext,
): Promise<JudgeResult | null> {
  const prompt = buildJudgePrompt(input)

  return traced(
    {
      name: 'auto_mode.judge',
      input: prompt,
      metadata: {
        userId: ctx?.userId,
        sessionId: ctx?.sessionId,
        teamId: ctx?.teamId,
        phase: 'auto_mode:judge',
        provider: config.agent.modelProvider,
        modelId: config.agent.autoMode.judgeModelId,
      },
    },
    async (span) => {
      const controller = new AbortController()
      const judgeCallId = newModelCallId()
      const timeout = setTimeout(() => {
        controller.abort()
      }, config.agent.autoMode.judgeTimeoutMs)

      try {
        // No `temperature`: Opus 4.7+ on Bedrock rejects the parameter outright
        // ("`temperature` is deprecated for this model"), which killed every
        // judge call → judge_unavailable → fail-safe require_auth for all
        // writes (prod incident).
        const response = await generateText({
          model: getModel(config.agent.autoMode.judgeModelId),
          maxOutputTokens: 400,
          system: judgeSystemPrompt,
          prompt,
          abortSignal: controller.signal,
        })
        const result = parseJudgeResponse(response.text)

        // The auto-mode judge runs on the MAIN agent model by default, so it is
        // the most expensive of the side calls — and was entirely absent from
        // agent_token_usage before this.
        await recordSideCallTokenUsage({
          operation: 'auto_mode.judge',
          callId: judgeCallId,
          modelId: config.agent.autoMode.judgeModelId,
          context: ctx ?? {},
          usage: response.usage,
        })

        span.log({
          output: response.text,
          metadata: {
            parsed: result !== null,
            requireAuth: result?.requireAuth ?? null,
            operation: result?.operation ?? null,
            matchedPolicyRule: result?.matchedPolicyRule ?? null,
          },
        })

        return result
      } catch (err) {
        // Fail-closed: caller requires authorization. LOUDLY — a silent judge
        // outage downgrades every write to require_auth and is invisible in
        // logs (only Braintrust spans hinted at it, with no error recorded).
        logError('agent.auto_mode.judge_failed', err, {
          judge_model_id: config.agent.autoMode.judgeModelId,
          session_id: ctx?.sessionId,
        })
        span.log({
          metadata: {
            judgeError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          },
        })

        return null
      } finally {
        clearTimeout(timeout)
      }
    },
  )
}

/** A Judge (decision.ts) bound to Bedrock + a context. */
export function makeBedrockJudge(ctx?: RunJudgeContext): Judge {
  return (input) => runAuthJudge(input, ctx)
}
