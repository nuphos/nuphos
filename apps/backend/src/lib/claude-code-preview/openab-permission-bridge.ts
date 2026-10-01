import { getSessionBypass } from '@/lib/agent/auto-mode/store'
import { hasPendingUserMessages } from '@/lib/agent/pending-messages'
import { logEvent } from '@/lib/observability'
import { capture } from '@/lib/posthog'

import {
  awaitPreviewDecision,
  registerPreviewWait,
  supersedePendingAgentPermissions,
} from './decision-waiter'

import type { PreviewDecision, PreviewWait } from './decision-waiter'
import type {
  OpenAbPermissionOption,
  OpenAbPermissionOutcome,
  OpenAbPermissionRequest,
} from './openab-acp-session'
import type { PreviewAgentUpdate } from './preview-agent-update'

// OpenAB's ACP gateway currently gives a prompt roughly three minutes to
// finish. Keep the human decision inside that envelope so a missed approval
// fails closed and returns control to the model instead of surfacing the
// misleading "Timed out waiting for agent backend" transport error first.
export const OPENAB_PERMISSION_DECISION_TIMEOUT_MS = 2 * 60_000
export const PERMISSION_TIMED_OUT_TEXT = 'Permission request timed out'
const PERMISSION_CANCELLED_TEXT = 'Permission request was cancelled'

type PermissionBridgeDeps = {
  getSessionBypass: (conversationId: string, userId: string) => Promise<boolean>
  registerWait: (args: {
    userId: string
    sessionId: string
    waitId?: string
    kind: 'agent-permission'
    ref: string
  }) => Promise<PreviewWait>
  awaitDecision: (args: {
    userId: string
    sessionId: string
    waitId: string
    timeoutMs: number
    signal?: AbortSignal
  }) => Promise<
    { timedOut: true; reason?: string } | { timedOut: false; decision: PreviewDecision }
  >
  hasPendingMessages?: (userId: string, sessionId: string) => Promise<boolean>
  supersedePermissions?: (args: {
    userId: string
    sessionId: string
    supersededByUserId?: string
  }) => Promise<number>
}

const defaultDeps: PermissionBridgeDeps = {
  getSessionBypass,
  registerWait: registerPreviewWait,
  awaitDecision: awaitPreviewDecision,
  hasPendingMessages: hasPendingUserMessages,
  supersedePermissions: supersedePendingAgentPermissions,
}

const cancelled = (): OpenAbPermissionOutcome => ({ outcome: { outcome: 'cancelled' } })

function optionById(
  options: OpenAbPermissionOption[],
  optionId: unknown,
): OpenAbPermissionOption | undefined {
  return typeof optionId === 'string'
    ? options.find((option) => option.optionId === optionId)
    : undefined
}

function allowOnce(options: OpenAbPermissionOption[]): OpenAbPermissionOption | undefined {
  return options.find((option) => option.kind === 'allow_once')
}

export async function handleOpenAbPermissionRequest(
  args: {
    userId: string
    conversationOwnerUserId?: string
    conversationId: string
    request: OpenAbPermissionRequest
    emit: (frame: Record<string, unknown>) => void
    handleTool: (update: Extract<PreviewAgentUpdate, { kind: 'tool' }>) => void
    /** Stops waiting when the turn is stopped; the agent is then answered with a cancel. */
    signal?: AbortSignal
    /** Called with the decision before the agent is answered, so the continuation lands on the decider's stream. */
    onDecision?: (decision: PreviewDecision) => void
  },
  deps: PermissionBridgeDeps = defaultDeps,
): Promise<OpenAbPermissionOutcome> {
  const { request } = args
  const toolCallId = request.toolCall.toolCallId

  if (!toolCallId || request.options.length === 0) {
    logEvent('warn', 'agent.openab_permission.cancelled', {
      reason: toolCallId ? 'no_options' : 'missing_tool_call_id',
      conversation_id: args.conversationId,
    })

    return cancelled()
  }
  // Nuphos MCP tool cards are normally hidden (the handler renders its own);
  // an approval request has nowhere to attach unless this card is visible.
  args.handleTool({
    kind: 'tool',
    toolCallId,
    title: request.toolCall.title,
    status: 'pending',
    revealed: true,
    ...(request.toolCall.rawInput === undefined ? {} : { rawInput: request.toolCall.rawInput }),
  })

  if (await deps.getSessionBypass(args.conversationId, args.userId)) {
    const allowed = allowOnce(request.options)

    args.emit({
      type: 'authorization-decision',
      toolCallId,
      decision: allowed ? 'allow' : 'deny',
      layer: 'bypass',
      reason: allowed
        ? 'Full Access is enabled for this conversation.'
        : 'OpenAB did not offer an allow option.',
    })

    return allowed ? { outcome: { outcome: 'selected', optionId: allowed.optionId } } : cancelled()
  }

  const wait = await deps.registerWait({
    userId: args.userId,
    sessionId: args.conversationId,
    kind: 'agent-permission',
    ref: toolCallId,
  })

  // Close both sides of the enqueue/register race. If the message arrived
  // first, this check resolves the wait we just registered. If the wait was
  // already visible first, the Slack enqueue path resolves it. In neither
  // ordering can an acknowledged message sit behind an approval timeout.
  const conversationOwnerUserId = args.conversationOwnerUserId ?? args.userId
  const hasPendingMessages = deps.hasPendingMessages ?? defaultDeps.hasPendingMessages!
  const supersedePermissions = deps.supersedePermissions ?? defaultDeps.supersedePermissions!

  if (await hasPendingMessages(conversationOwnerUserId, args.conversationId)) {
    const superseded = await supersedePermissions({
      userId: args.userId,
      sessionId: args.conversationId,
    })

    const properties = {
      session_id: args.conversationId,
      conversation_owner_user_id: conversationOwnerUserId,
      active_actor_user_id: args.userId,
      tool_call_id: toolCallId,
      superseded_count: superseded,
      source: 'openab_permission_bridge',
      race_order: 'message_before_permission',
    }

    logEvent('info', 'agent.permission.superseded_by_user_message', properties)
    capture('agent_permission_superseded_by_user_message', {
      distinctId: args.userId,
      properties,
    })

    return cancelled()
  }

  args.emit({
    type: 'authorization-decision',
    toolCallId,
    decision: 'require_auth',
    layer: 'openab_acp',
    reason: 'OpenAB requested permission before running this tool.',
  })
  args.emit({
    type: 'tool-approval-request',
    toolCallId,
    approvalId: `openab:${wait.waitId}`,
    source: 'openab',
    options: request.options,
  })

  const resolved = await deps.awaitDecision({
    userId: args.userId,
    sessionId: args.conversationId,
    waitId: wait.waitId,
    timeoutMs: OPENAB_PERMISSION_DECISION_TIMEOUT_MS,
    ...(args.signal ? { signal: args.signal } : {}),
  })
  const settleDenied = (errorText: string): OpenAbPermissionOutcome => {
    args.handleTool({
      kind: 'tool',
      toolCallId,
      title: request.toolCall.title,
      status: 'failed',
      contentText: errorText,
      revealed: true,
    })
    logEvent('info', 'agent.openab_permission.denied', {
      conversation_id: args.conversationId,
      tool_call_id: toolCallId,
      reason: errorText,
    })

    return cancelled()
  }

  if (resolved.timedOut || args.signal?.aborted) {
    return settleDenied(
      resolved.timedOut && resolved.reason === 'timeout'
        ? PERMISSION_TIMED_OUT_TEXT
        : PERMISSION_CANCELLED_TEXT,
    )
  }
  args.onDecision?.(resolved.decision)
  const { payload } = resolved.decision

  if (payload.decision !== 'approved') {
    // A person's deny carries no reason; abandoned waits (runtime Stop, supersede,
    // OpenAB's own cancel) always do.
    return settleDenied(
      payload.reason === undefined ? 'Permission denied' : PERMISSION_CANCELLED_TEXT,
    )
  }
  const selected =
    payload.selectedOptionId === undefined
      ? allowOnce(request.options)
      : optionById(request.options, payload.selectedOptionId)

  return selected
    ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
    : settleDenied('Permission denied')
}
