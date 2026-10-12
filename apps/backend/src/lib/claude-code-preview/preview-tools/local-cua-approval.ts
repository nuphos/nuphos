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

export async function approveAppForComputerUse(
  ctx: PreviewToolContext,
  request: { message: string; meta: Record<string, unknown> },
): Promise<boolean> {
  if (await getSessionBypass(ctx.sessionId, ctx.userId)) return true
  // Its own card: one call can ask for several apps, and each answer resumes the turn.
  const toolCallId = `nuphos-${randomUUID()}`
  const publish = (frame: Record<string, unknown>) =>
    publishPreviewFrame(ctx, { toolCallId, ...frame }).catch(() => {})

  await publish({
    type: 'tool-input-available',
    toolName: 'local_cua',
    input: { approval: request.message, app: request.meta.tool_params },
  })
  await registerPreviewWait({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    waitId: toolCallId,
    kind: 'authorization-rule',
  })
  await publish({ type: 'tool-approval-request', approvalId: toolCallId })
  const outcome = await awaitDecisionOnce({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    waitId: toolCallId,
    kind: 'authorization-rule',
    timeoutMs: OPENAB_PERMISSION_DECISION_TIMEOUT_MS,
  })
  const approved = outcome.status === 'decided' && outcome.decision.payload.decision === 'approved'

  await publish(
    approved
      ? { type: 'tool-output-available', output: { approved } }
      : { type: 'tool-output-error', errorText: 'Not approved' },
  )

  return approved
}
