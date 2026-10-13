import { parseToolUpdate } from './preview-agent-update'
import { parseSessionExecutionState } from './runtime-execution-snapshot'

import type { PreviewAgentUpdate } from './preview-agent-update'
import type { SessionExecutionState } from './runtime-execution-snapshot'

export type OpenAbSessionUpdate =
  | { kind: 'text'; text: string }
  | { kind: 'agent'; update: PreviewAgentUpdate }
  | { kind: 'status'; status: string; runtimeSnapshot?: SessionExecutionState }
  | { kind: 'prompt-suggestion'; suggestion: string }
  | {
      kind: 'async-task'
      asyncTaskId: string
      phase: 'spawned' | 'terminal'
      state?: 'completed' | 'failed' | 'stopped'
      name?: string
      toolCallId?: string
    }
  | { kind: 'complete'; origin?: unknown; runtimeSnapshot?: SessionExecutionState }
  // OpenAB itself reporting that the relay carrying an agent-initiated turn
  // lost its connection: the session was suspended for pool capacity, force
  // evicted, or the agent process died. The agent's own terminal update died
  // with it, so this is the only end-of-turn signal that will ever arrive.
  | { kind: 'interrupted'; reason?: string; runtimeSnapshot?: SessionExecutionState }

export type PromptUpdateTarget = {
  onTextDelta?: (text: string) => void
  onAgentUpdate?: (update: PreviewAgentUpdate) => void
}

export function observeOpenAbSessionUpdates(
  observers: Map<string, Set<(update: OpenAbSessionUpdate) => void>>,
  cancelledSessions: Set<string>,
  sessionId: string,
  handler: (update: OpenAbSessionUpdate) => void,
): () => void {
  const handlers = observers.get(sessionId) ?? new Set()

  handlers.add(handler)
  observers.set(sessionId, handlers)

  return () => {
    handlers.delete(handler)
    if (handlers.size === 0 && observers.get(sessionId) === handlers) {
      observers.delete(sessionId)
      // With no autonomous listener, late updates are dropped by routing.
      // An evicted session no longer needs a fence in the pooled client.
      cancelledSessions.delete(sessionId)
    }
  }
}

const AUTONOMOUS_RESULT_ORIGINS = new Set([
  'task-notification',
  'peer',
  'coordinator',
  'observer',
  'observer-activity',
])

function autonomousResultOrigin(payload: Record<string, unknown>): Record<string, unknown> | null {
  const meta = payload._meta

  if (!meta || typeof meta !== 'object') return null
  const origin = (meta as Record<string, unknown>)['_claude/origin']

  if (!origin || typeof origin !== 'object') return null
  const kind = (origin as Record<string, unknown>).kind

  return typeof kind === 'string' && AUTONOMOUS_RESULT_ORIGINS.has(kind)
    ? (origin as Record<string, unknown>)
    : null
}

function chunkUpdate(kind: unknown, payload: Record<string, unknown>): OpenAbSessionUpdate | null {
  const content = payload.content

  if (!content || typeof content !== 'object') return null
  const text = (content as Record<string, unknown>).text

  if (typeof text !== 'string' || text.length === 0) return null

  return kind === 'agent_message_chunk'
    ? { kind: 'text', text }
    : { kind: 'agent', update: { kind: 'thought', text } }
}

function runtimeThreadStatus(payload: Record<string, unknown>): string | null {
  const meta = payload._meta

  if (!meta || typeof meta !== 'object') return null
  const common = (meta as Record<string, unknown>)['ai.nuphos/sessionState']

  if (
    common &&
    typeof common === 'object' &&
    typeof (common as Record<string, unknown>).state === 'string'
  ) {
    return (common as { state: string }).state
  }
  const codex = (meta as Record<string, unknown>).codex

  if (!codex || typeof codex !== 'object') return null
  const threadStatus = (codex as Record<string, unknown>).threadStatus

  if (!threadStatus || typeof threadStatus !== 'object') return null
  const status = (threadStatus as Record<string, unknown>).type

  return typeof status === 'string' ? status : null
}

function normalizeUpdate(payload: Record<string, unknown>): OpenAbSessionUpdate | null {
  const kind = payload.sessionUpdate

  if (
    kind === 'steering_message' &&
    typeof payload.id === 'string' &&
    typeof payload.text === 'string'
  )
    return { kind: 'agent', update: { kind: 'steering', id: payload.id, text: payload.text } }

  if (kind === 'runtime_state' && payload.snapshot && typeof payload.snapshot === 'object') {
    try {
      return {
        kind: 'agent',
        update: {
          kind: 'runtime-state',
          snapshot: parseSessionExecutionState(payload.snapshot as Record<string, unknown>),
        },
      }
    } catch {
      return null
    }
  }

  if (kind === 'openab_session_interrupted') {
    const reason = payload.reason

    return { kind: 'interrupted', ...(typeof reason === 'string' ? { reason } : {}) }
  }

  if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
    return chunkUpdate(kind, payload)
  }
  if (kind === 'async_task_spawned') {
    const asyncTaskId = payload.asyncTaskId

    if (typeof asyncTaskId !== 'string' || !asyncTaskId) return null

    return {
      kind: 'async-task',
      asyncTaskId,
      phase: 'spawned',
      ...(typeof payload.name === 'string' && payload.name ? { name: payload.name } : {}),
      ...(typeof payload.toolCallId === 'string' && payload.toolCallId
        ? { toolCallId: payload.toolCallId }
        : {}),
    }
  }
  if (kind === 'async_task_state_update') {
    const asyncTaskId = payload.asyncTaskId
    const state = payload.state

    if (
      typeof asyncTaskId !== 'string' ||
      !asyncTaskId ||
      (state !== 'completed' && state !== 'failed' && state !== 'stopped')
    )
      return null

    return {
      kind: 'async-task',
      asyncTaskId,
      phase: 'terminal',
      state,
      ...(typeof payload.toolCallId === 'string' && payload.toolCallId
        ? { toolCallId: payload.toolCallId }
        : {}),
    }
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const toolCallId = payload.toolCallId

    return typeof toolCallId === 'string' && toolCallId
      ? { kind: 'agent', update: parseToolUpdate(toolCallId, payload) }
      : null
  }
  if (kind === 'session_info_update') {
    const suggestion = (payload._meta as Record<string, { suggestion?: unknown }> | undefined)?.[
      'ai.nuphos/promptSuggestion'
    ]?.suggestion

    if (typeof suggestion === 'string') return { kind: 'prompt-suggestion', suggestion }
    const status = runtimeThreadStatus(payload)

    return status ? { kind: 'status', status } : null
  }
  if (kind !== 'usage_update') return null
  // Claude emits ordinary usage snapshots while an autonomous cycle is still
  // streaming (including between tool start and tool completion). Only the
  // result-scoped update carries an autonomous origin and marks the real turn
  // boundary. Treating every usage update as terminal strands live tools and
  // splits the wakeup across multiple assistant messages.
  const origin = autonomousResultOrigin(payload)

  if (!origin) return null

  return {
    kind: 'complete',
    origin,
  }
}

export function deliverOpenAbSessionUpdate(args: {
  cancelledSessions: Set<string>
  params: unknown
  pending: PromptUpdateTarget[]
  notify: (sessionId: string, update: OpenAbSessionUpdate) => void
}): void {
  if (!args.params || typeof args.params !== 'object') return
  const params = args.params as Record<string, unknown>
  const sessionId = params.sessionId
  const rawUpdate = params.update

  if (typeof sessionId !== 'string' || !rawUpdate || typeof rawUpdate !== 'object') return
  const update = normalizeUpdate(rawUpdate as Record<string, unknown>)

  if (!update) return
  if (update.kind === 'agent' && update.update.kind === 'runtime-state') {
    // Runtime lifecycle crosses transport-content fences. The runtime owns
    // cancellation and subsequent continuations; the client cannot hide them.
    args.cancelledSessions.delete(sessionId)
  }
  if (args.cancelledSessions.has(sessionId) && args.pending.length === 0) {
    // A cancelled observed session stays fenced until an explicit prompt
    // clears the tombstone. Prompt-owned updates still reach the active prompt
    // sink until the runtime's terminal response; otherwise its final tool
    // states would be discarded before the authoritative turn boundary.
    return
  }
  // Async-task lifecycle, provider status and the next-prompt suggestion
  // belong to the session, not to whichever prompt is currently in flight.
  // The persistent observer uses them to recognize work that outlives the
  // prompt response; passing any of them through PromptUpdateTarget would also
  // be invalid because none is prompt content.
  if (
    update.kind === 'async-task' ||
    update.kind === 'status' ||
    update.kind === 'prompt-suggestion'
  ) {
    if (args.cancelledSessions.has(sessionId)) return
    args.notify(sessionId, update)

    return
  }
  if (args.pending.length === 0) {
    args.notify(sessionId, update)

    return
  }
  // A streaming prompt owns its deadline; autonomous turn boundaries do not end it.
  if (update.kind === 'complete' || update.kind === 'interrupted') return
  for (const target of args.pending) {
    if (update.kind === 'text') target.onTextDelta?.(update.text)
    else target.onAgentUpdate?.(update.update)
  }
}

export function routeOpenAbSessionUpdate(args: {
  cancelledSessions: Set<string>
  handlers: Map<string, Set<(update: OpenAbSessionUpdate) => void>>
  params: unknown
  pending: (PromptUpdateTarget & { sessionId?: string; accepted?: boolean })[]
}): void {
  const sessionId =
    args.params && typeof args.params === 'object'
      ? (args.params as Record<string, unknown>).sessionId
      : undefined

  deliverOpenAbSessionUpdate({
    params: args.params,
    pending:
      typeof sessionId === 'string'
        ? args.pending.filter(
            (call) =>
              call.sessionId === sessionId &&
              Boolean(call.onTextDelta ?? call.onAgentUpdate) &&
              (call.accepted !== false ||
                (args.params as { update?: { sessionUpdate?: string } }).update?.sessionUpdate ===
                  'runtime_state'),
          )
        : [],
    notify: (id, update) => {
      for (const handler of args.handlers.get(id) ?? []) handler(update)
    },
    cancelledSessions: args.cancelledSessions,
  })
}
