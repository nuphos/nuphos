export type RuntimeRequest = {
  waitId: string
  kind: string
  label?: string
  ref?: string
  clientTool?: { toolName: string; input?: unknown; streamId?: string }
  createdAt: number
}

export type AgentCommand = { name: string; description: string; hint?: string }

export type RuntimeExecution = {
  state: 'active' | 'idle' | 'dormant' | 'interrupted' | 'unknown' | 'disconnected' | 'unsupported'
  schemaVersion?: number
  phase?: string
  label?: string
  providerState?: string
  providerEpoch?: string | null
  providerDetails?: Record<string, unknown> | null
  asyncTasks?: Record<string, { id: string; name?: string; state: string; toolCallId?: string }>
  automation?: { pending: string[]; running: boolean; error: string | null }
  operation?: string
  requestPending?: boolean
  requests?: RuntimeRequest[]
  permissionWaits?: number
  tools?: {
    id: string
    status?: string
    title?: string
    kind?: string
    terminal?: {
      terminalId: string
      command?: string
      output?: string
      status: 'running' | 'exited'
    }
    /** A desktop this session holds on its Box: the X display, on which device. */
    desktop?: { display: number; deviceId: string }
  }[]
  actions?: { send: boolean; cancel: boolean; steer: boolean; reply?: boolean }
  /** Its Box runs a desktop pool: the owner can open this session's desktop by hand. */
  canOpenDesktop?: boolean
  /** The agent's own slash commands, as the runtime last saw them. */
  commands?: AgentCommand[]
  epoch?: string
  revision?: number
}

/** A transport, a buffered frame, and a tool card cannot authorize execution. */
export function runtimeIsExecuting(snapshot: RuntimeExecution | undefined): boolean {
  return snapshot?.state === 'active'
}

/**
 * A user-visible turn, including a queued or running automatic continuation.
 * Sidebar rows show the last known state; how old it is says nothing about the session.
 */
export function runtimeTurnActive(snapshot: RuntimeExecution | undefined): boolean {
  return snapshot?.state === 'active' && snapshot.phase !== 'resume_disconnected'
}

/** The turn ended while runtime-owned background tools or tasks keep running. */
export function runtimeBackgroundRunning(snapshot: RuntimeExecution | undefined): boolean {
  return (
    !runtimeTurnActive(snapshot) &&
    snapshot?.schemaVersion === 2 &&
    snapshot.phase === 'background_tools'
  )
}

export type ChatRowIndicator = 'turn' | 'error' | 'background' | 'unread' | 'none'

/** A running turn outranks a stopped runtime, then background work, then an unread reply. */
export function chatRowIndicator(
  snapshot: RuntimeExecution | undefined,
  unread: boolean,
): ChatRowIndicator {
  if (runtimeTurnActive(snapshot)) return 'turn'
  if (
    snapshot &&
    (!['idle', 'dormant'].includes(snapshot.state) ||
      ['failed', 'resume_failed', 'stopped'].includes(snapshot.phase ?? ''))
  )
    return 'error'
  if (runtimeBackgroundRunning(snapshot)) return 'background'

  return unread ? 'unread' : 'none'
}

/**
 * The one ordering rule: within a runtime process the higher revision is newer.
 * Across processes, or for a reading without one, the later arrival wins.
 */
export function acceptRuntimeSnapshot(
  current: RuntimeExecution | undefined,
  next: RuntimeExecution,
): RuntimeExecution {
  return current?.epoch &&
    current.epoch === next.epoch &&
    typeof current.revision === 'number' &&
    typeof next.revision === 'number' &&
    next.revision < current.revision
    ? current
    : next
}

export function runtimeAllows(
  snapshot: RuntimeExecution | undefined,
  action: 'send' | 'cancel' | 'steer' | 'reply',
): boolean {
  return snapshot?.schemaVersion === 2 && snapshot.actions?.[action] === true
}

export function runtimeStateLabel(snapshot: RuntimeExecution | undefined): string {
  if (!snapshot || snapshot.state === 'disconnected')
    return 'Connection lost — runtime status unavailable'
  if (snapshot.schemaVersion !== 2) return 'Runtime status unavailable — runtime update required'

  return snapshot.label || `Runtime: ${snapshot.phase || snapshot.state}`
}
