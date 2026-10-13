// Model call for the thread-addressing judge (see thread-addressing-core.ts
// for the question it answers and the prompt).
//
// Runs on the small/fast compaction model with a short timeout, on the inbound
// path of every un-mentioned reply in a registered Slack thread. Fails OPEN:
// a timeout, provider error, or unparseable reply returns null and the caller
// treats that as "answer it" — the pre-existing behaviour. A judge that is
// merely unsure says false (the prompt tells it to); a judge that is BROKEN
// must not silently swallow the thread.
import { generateText } from 'ai'

import { config } from '@/config'
import {
  buildThreadAddressingPrompt,
  collaborativeThreadAddressingSystemPrompt,
  parseThreadAddressingResponse,
  threadAddressingSystemPrompt,
} from '@/lib/agent/thread-addressing-core'
import { newModelCallId, recordSideCallTokenUsage } from '@/lib/agent/token-usage-side-call'
import { traced } from '@/lib/agent/tracing'
import { logError } from '@/lib/observability'

import { getModel } from './model-provider'

import type {
  ThreadAddressingInput,
  ThreadAddressingResult,
} from '@/lib/agent/thread-addressing-core'

export type { ThreadAddressingInput, ThreadAddressingResult }

export type ThreadAddressingJudgement = {
  verdict: ThreadAddressingResult | null
  /** The exact prompt sent to the model, so the caller can persist it without
   *  re-assembling (and drifting from) what the judge actually saw. */
  prompt: string
  /** Raw model text; null when the call itself failed. */
  rawText: string | null
  modelId: string
}

// Tighter than the stop gate's 8s: this one sits between the user pressing
// enter and the agent reacting at all, so a slow judge reads as a dead bot.
const JUDGE_TIMEOUT_MS = 5_000

export async function judgeThreadAddressing(
  input: ThreadAddressingInput,
): Promise<ThreadAddressingJudgement> {
  const prompt = buildThreadAddressingPrompt(input)
  const modelId = config.agent.compactionModelId

  return traced(
    {
      name: 'thread_addressing.judge',
      input: prompt,
      metadata: {
        userId: input.context?.userId,
        sessionId: input.context?.sessionId,
        teamId: input.context?.teamId,
        slackChannelId: input.context?.slackChannelId,
        slackThreadTs: input.context?.slackThreadTs,
        phase: 'thread_addressing:judge',
        participation: input.participation ?? 'direct-addressing',
        provider: config.agent.modelProvider,
        modelId,
      },
    },
    async (span) => {
      const controller = new AbortController()
      const judgeCallId = newModelCallId()
      const timeout = setTimeout(() => {
        controller.abort()
      }, JUDGE_TIMEOUT_MS)

      try {
        // No `temperature`: newer Anthropic models on Bedrock reject the
        // parameter outright (killed the auto-mode judge).
        const response = await generateText({
          model: getModel(modelId),
          maxOutputTokens: 200,
          system:
            input.participation === 'collaborative'
              ? collaborativeThreadAddressingSystemPrompt
              : threadAddressingSystemPrompt,
          prompt,
          abortSignal: controller.signal,
        })
        const result = parseThreadAddressingResponse(response.text)

        await recordSideCallTokenUsage({
          operation: 'thread_addressing.judge',
          callId: judgeCallId,
          modelId,
          context: input.context ?? {},
          usage: response.usage,
        })

        span.log({
          output: response.text,
          metadata: {
            parsed: result !== null,
            addressed: result?.addressed ?? null,
          },
          metrics: {
            ...(response.usage?.inputTokens != null
              ? { prompt_tokens: response.usage.inputTokens }
              : {}),
            ...(response.usage?.outputTokens != null
              ? { completion_tokens: response.usage.outputTokens }
              : {}),
          },
        })

        return { verdict: result, prompt, rawText: response.text, modelId }
      } catch (err) {
        logError('agent.thread_addressing.judge_failed', err, {
          judge_model_id: modelId,
          session_id: input.context?.sessionId,
        })

        return { verdict: null, prompt, rawText: null, modelId }
      } finally {
        clearTimeout(timeout)
      }
    },
  )
}
