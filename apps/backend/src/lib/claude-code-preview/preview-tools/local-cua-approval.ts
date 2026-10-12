// Computer Use asks before it controls each app. The question becomes its own
// approval card that parks the turn like any other decision, so the answer
// resumes the turn on the decider's stream. OpenAB knows this wait kind as
// `authorization-rule`.
import { randomUUID } from 'node:crypto'

import { getSessionBypass } from '@/lib/agent/auto-mode/store'

import { registerPreviewWait } from '../decision-waiter'
import { OPENAB_PERMISSION_DECISION_TIMEOUT_MS } from '../openab-permission-bridge'
import { publishPreviewFrame } from '../run-frame-bridge'

import { awaitDecisionOnce } from './decision-wait'

import type { PreviewToolContext } from '../preview-tool-context'

export type AppApprovalDeps = {
  bypass: typeof getSessionBypass
  publish: typeof publishPreviewFrame
  register: typeof registerPreviewWait
  await: typeof awaitDecisionOnce
  timeoutMs: number
}

const defaultDeps: AppApprovalDeps = {
  bypass: getSessionBypass,
  publish: publishPreviewFrame,
  register: registerPreviewWait,
  await: awaitDecisionOnce,
  timeoutMs: OPENAB_PERMISSION_DECISION_TIMEOUT_MS,
}

export async function approveAppForComputerUse(
  ctx: PreviewToolContext,
  request: { message: string; meta: Record<string, unknown> },
  deps: AppApprovalDeps = defaultDeps,
): Promise<boolean> {
  // Its own card: one call can ask for several apps, and each answer resumes the turn.
  const toolCallId = `nuphos-${randomUUID()}`
  const publish = (frame: Record<string, unknown>) =>
    deps.publish(ctx, { toolCallId, ...frame }).catch(() => {})

  await publish({
    type: 'tool-input-available',
    toolName: 'local_cua',
    input: { approval: request.message, app: request.meta.tool_params },
  })
  if (await deps.bypass(ctx.sessionId, ctx.userId)) {
    // The transcript keeps what the agent was allowed to control without asking.
    await publish({
      type: 'authorization-decision',
      decision: 'allow',
      layer: 'bypass',
      reason: 'Full Access is enabled for this conversation.',
    })
    await publish({ type: 'tool-output-available', output: { approved: true } })

    return true
  }
  await deps.register({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    waitId: toolCallId,
    kind: 'authorization-rule',
  })
  await publish({ type: 'tool-approval-request', approvalId: toolCallId })
  const outcome = await deps.await({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    waitId: toolCallId,
    kind: 'authorization-rule',
    timeoutMs: deps.timeoutMs,
  })
  const approved = outcome.status === 'decided' && outcome.decision.payload.decision === 'approved'

  await publish(
    approved
      ? { type: 'tool-output-available', output: { approved } }
      : { type: 'tool-output-error', errorText: 'Not approved' },
  )

  return approved
}
