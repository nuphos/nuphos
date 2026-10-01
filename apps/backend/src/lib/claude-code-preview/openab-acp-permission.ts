import { logError, logEvent } from '@/lib/observability'

import type {
  OpenAbPermissionHandler,
  OpenAbPermissionOutcome,
  OpenAbPermissionRequest,
} from './openab-acp-session'

type PermissionTarget = {
  sessionId?: string
  onPermissionRequest?: OpenAbPermissionHandler
}

const cancelled = (): OpenAbPermissionOutcome => ({ outcome: { outcome: 'cancelled' } })

function parsePermissionRequest(params: unknown): OpenAbPermissionRequest | null {
  if (!params || typeof params !== 'object') return null
  const value = params as Record<string, unknown>
  const toolCall = value.toolCall

  if (
    typeof value.sessionId !== 'string' ||
    !toolCall ||
    typeof toolCall !== 'object' ||
    typeof (toolCall as Record<string, unknown>).toolCallId !== 'string' ||
    !Array.isArray(value.options)
  ) {
    return null
  }
  const options = value.options.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const option = candidate as Record<string, unknown>

    return typeof option.optionId === 'string' &&
      typeof option.name === 'string' &&
      typeof option.kind === 'string'
      ? [{ optionId: option.optionId, name: option.name, kind: option.kind }]
      : []
  })

  return {
    sessionId: value.sessionId,
    toolCall: {
      toolCallId: (toolCall as Record<string, unknown>).toolCallId as string,
      title:
        typeof (toolCall as Record<string, unknown>).title === 'string'
          ? ((toolCall as Record<string, unknown>).title as string)
          : 'OpenAB tool request',
      ...((toolCall as Record<string, unknown>).rawInput === undefined
        ? {}
        : { rawInput: (toolCall as Record<string, unknown>).rawInput }),
    },
    options,
  }
}

export async function answerPermissionRequest(args: {
  params: unknown
  targets: PermissionTarget[]
  /**
   * Answers a request that belongs to no in-flight prompt. The runtime starts
   * turns on its own (a ScheduleWakeup firing, a background task reporting
   * back), and those tool calls must still reach the authorization layer
   * instead of being cancelled for want of a pending `session/prompt`.
   */
  sessionFallback?: (sessionId: string) => OpenAbPermissionHandler | undefined
  send: (result: OpenAbPermissionOutcome) => void
}): Promise<void> {
  const request = parsePermissionRequest(args.params)
  const pendingHandler = request
    ? args.targets.find(
        (target) => target.sessionId === request.sessionId && target.onPermissionRequest,
      )?.onPermissionRequest
    : undefined
  const handler =
    request && !pendingHandler ? args.sessionFallback?.(request.sessionId) : pendingHandler
  let result = cancelled()

  // Every fail-closed branch here silently cancels the agent's tool call,
  // which the runtime then reports as a completed empty turn — the user sees
  // "(no response)". Name the branch so a cancel is always attributable.
  if (!request) {
    const shape =
      args.params && typeof args.params === 'object'
        ? Object.fromEntries(
            Object.entries(args.params as Record<string, unknown>).map(([k, v]) => [
              k,
              Array.isArray(v) ? `array[${String(v.length)}]` : typeof v,
            ]),
          )
        : { params: typeof args.params }

    logEvent('warn', 'agent.openab_permission.cancelled', { reason: 'parse_failed', ...shape })
  } else if (!handler) {
    logEvent('warn', 'agent.openab_permission.cancelled', {
      reason: 'no_handler_for_session',
      openab_session_id: request.sessionId,
      tool_call_id: request.toolCall.toolCallId,
      target_session_ids: args.targets.map((t) => t.sessionId ?? 'none').join(','),
      session_fallback_registered: Boolean(args.sessionFallback),
    })
  } else {
    try {
      result = await handler(request)
    } catch (err) {
      // Permission handling is an authorization boundary; still fail closed.
      logError('agent.openab_permission.handler_failed', err, {
        openab_session_id: request.sessionId,
        tool_call_id: request.toolCall.toolCallId,
      })
    }
  }
  try {
    args.send(result)
  } catch {
    // A disconnected transport cannot receive the decision; OpenAB also
    // fails the inner request closed when its relay handle disappears.
  }
}
