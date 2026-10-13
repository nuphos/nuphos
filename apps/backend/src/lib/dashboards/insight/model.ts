import { generateText as rawGenerateText, NoObjectGeneratedError, Output } from 'ai'
import { z } from 'zod'

import { config } from '@/config'
import { getModel } from '@/lib/agent/model-provider'
import { newModelCallId, recordSideCallTokenUsage } from '@/lib/agent/token-usage-side-call'
import { aiTelemetry, wrapAI } from '@/lib/agent/tracing'
import { logError } from '@/lib/observability'

import { embedJson, MAX_OUTPUT_CHARS, MAX_PARAMS_CHARS, MAX_PREVIOUS_OUTPUT_CHARS } from './compact'

import type { DashboardPanel, DashboardPanelSnapshot } from '@/models'

const { generateText } = wrapAI({ generateText: rawGenerateText })

// Bounded so a runaway response cannot burn the whole context; comfortably above
// the worst case the schema allows (4 findings + 3 actions at their max lengths).
const INSIGHT_MAX_OUTPUT_TOKENS = 8_000

// The LLM produces this shape; it's read-only over an existing snapshot (no
// runtime job, no script). Actions must hand off to a plan/confirmation, reusing
// the v1 guard so we never generate a one-click mutation.
// Keep the response compact enough to be useful in the UI. AI SDK v6 parses
// and validates the response with `Output.object`, rather than relying on
// brittle JSON extraction from free-form text.
export const insightResultSchema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        detail: z.string().min(1).max(700),
        kind: z.enum(['insight', 'anomaly', 'driver', 'hypothesis']),
        confidence: z.enum(['high', 'medium', 'low']),
        evidence: z.string().max(400).optional(),
      }),
    )
    .max(4),
  actions: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        detail: z.string().min(1).max(700),
        prompt: z
          .string()
          .min(1)
          .max(1_200)
          .refine(
            (v) => /plan|計畫|確認|confirm/i.test(v),
            'action prompt must request a plan/confirmation',
          )
          .describe(
            'A safe handoff asking Nuphos to investigate, produce a Plan, and obtain user confirmation before any change. Must contain plan, 計畫, or 確認.',
          ),
        risk: z.enum(['low', 'medium', 'high']),
        estimatedImpactUsd: z.number().finite().nonnegative().optional(),
      }),
    )
    .max(3),
})

export type InsightResult = z.infer<typeof insightResultSchema>

/** Why an attempt produced no usable object — surfaced in `insight.error` so a
 *  failure is debuggable instead of a flat "did not return a valid insight". */
export type InsightFailure = 'output_truncated' | 'schema_mismatch' | 'model_error'

/** Repair instruction for the second attempt. A blind retry of the identical
 *  prompt reproduces the identical failure, so each retryable failure gets the
 *  correction that addresses it. */
const RETRY_HINT: Record<Exclude<InsightFailure, 'model_error'>, string> = {
  output_truncated:
    'Your previous reply was cut off before it was complete. Return AT MOST 2 findings and 1 action, every detail under 250 characters.',
  schema_mismatch:
    'Your previous reply did not match the required schema. Respect every field length limit, and make sure each action.prompt contains "plan" (or 計畫/確認).',
}

export function buildInsightPrompt(
  panel: Pick<DashboardPanel, 'title' | 'kind'>,
  snapshot: Pick<DashboardPanelSnapshot, 'params' | 'output'>,
  previous: Pick<DashboardPanelSnapshot, 'output'> | null,
  retryAfter: Exclude<InsightFailure, 'model_error'> | null = null,
): string {
  const limits =
    retryAfter === 'output_truncated'
      ? '- Return AT MOST 2 findings and 1 action. Keep every detail under 250 characters.'
      : '- Return at most 4 findings and 3 actions. Keep every detail under 500 characters — be dense, not long.'

  return [
    'You are an infrastructure and FinOps analyst reading one panel of a team dashboard. The panel may chart spend, usage, reliability, or any other metric.',
    'Interpret the data below and return concise, evidence-backed insights bound to safe next actions.',
    ...(retryAfter ? ['', RETRY_HINT[retryAfter]] : []),
    '',
    `Panel: ${panel.title} (kind: ${panel.kind})`,
    `Resolved params: ${embedJson(snapshot.params, MAX_PARAMS_CHARS)}`,
    `Current snapshot output: ${embedJson(snapshot.output, MAX_OUTPUT_CHARS)}`,
    previous?.output
      ? `Previous snapshot output (for change context): ${embedJson(previous.output, MAX_PREVIOUS_OUTPUT_CHARS)}`
      : 'No previous snapshot.',
    '',
    'Rules:',
    limits,
    '- Do NOT fabricate — if evidence is thin, use kind "hypothesis" or return fewer findings.',
    '- Compacted chart output retains first/last samples plus per-series summaries; compacted tables expose total rowCount, ranked topRows, and representativeRows.',
    '- Every action.prompt is a HANDOFF that asks Nuphos to investigate and produce a Plan for user confirmation before any change. It MUST contain the word "plan" (or 計畫/確認).',
    '- Write findings.detail in the same language as the panel title when it is Chinese; otherwise English.',
  ].join('\n')
}

function classifyFailure(err: unknown): InsightFailure {
  // `generateText` only parses the structured output when the step finished with
  // `stop`, so a NoObjectGeneratedError always carries finishReason 'stop' — a
  // truncated response never reaches this path (see the finishReason check in
  // callModel) and would otherwise surface as an opaque NoOutputGeneratedError.
  if (NoObjectGeneratedError.isInstance(err)) return 'schema_mismatch'

  return 'model_error'
}

export const FAILURE_MESSAGE: Record<InsightFailure, string> = {
  output_truncated:
    'The model response ended before completing the insight. Regenerate the insight or narrow the panel data.',
  schema_mismatch: 'The model returned a response that did not match the insight schema.',
  model_error: 'The insight model call failed.',
}

// Obviously synthetic: panel insights are a team-scheduled job, so their spend
// has no member to attribute to.
const INSIGHT_SYSTEM_USER_ID = 'system:cost-insight'

export async function callModel(
  panel: DashboardPanel,
  snapshot: DashboardPanelSnapshot,
  previous: DashboardPanelSnapshot | null,
  ctx: { teamId: string; panelId: string },
): Promise<{ result: InsightResult } | { failure: InsightFailure }> {
  const modelId = config.dashboards.insightModel ?? config.agent.agentModelId
  const model = getModel(modelId)
  let last: InsightFailure = 'model_error'
  let retryAfter: Exclude<InsightFailure, 'model_error'> | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    // Built before the call so `result`'s inferred type does not depend on the
    // flow-narrowed type of `retryAfter`, which `result` itself feeds.
    const prompt: string = buildInsightPrompt(panel, snapshot, previous, retryAfter)
    // Per ATTEMPT, not per call: a retried generation is a second real charge.
    const callId = newModelCallId()

    try {
      const result = await generateText({
        model,
        maxOutputTokens: INSIGHT_MAX_OUTPUT_TOKENS,
        output: Output.object({
          schema: insightResultSchema,
          name: 'panel_insight',
          description:
            'Evidence-backed findings and safe plan/confirmation handoffs for one dashboard panel.',
        }),
        experimental_telemetry: aiTelemetry({
          teamId: ctx.teamId,
          phase: 'cost-insight',
          provider: config.agent.modelProvider,
          modelId,
        }),
        prompt,
      })

      // Scheduled per team with no human user, so it bills under the system
      // id. Recorded before the finish-reason branch: a truncated response is
      // still charged for every token the provider produced.
      await recordSideCallTokenUsage({
        operation: 'cost_insight',
        callId,
        modelId,
        context: { teamId: ctx.teamId },
        systemUserId: INSIGHT_SYSTEM_USER_ID,
        usage: (result as { usage?: unknown }).usage,
      })

      // Only a `stop` finish means the structured output was parsed. Reading
      // `result.output` after any other finish reason throws an opaque
      // NoOutputGeneratedError, which would misclassify a truncated response as
      // `model_error` and skip the retry that exists to fix it.
      if (result.finishReason !== 'stop') {
        const failure: InsightFailure =
          result.finishReason === 'length' ? 'output_truncated' : 'model_error'

        last = failure
        logError(
          'dashboard.insight.attempt_failed',
          new Error(`insight generation finished with "${result.finishReason}"`),
          { panel_id: ctx.panelId, snapshot_id: snapshot._id.toHexString(), attempt, failure },
        )
        if (failure === 'model_error') break
        retryAfter = failure
        continue
      }

      return { result: result.output }
    } catch (err) {
      const failure = classifyFailure(err)

      last = failure
      logError('dashboard.insight.attempt_failed', err, {
        panel_id: ctx.panelId,
        snapshot_id: snapshot._id.toHexString(),
        attempt,
        failure,
      })
      if (failure === 'model_error') break
      retryAfter = failure
    }
  }

  return { failure: last }
}
