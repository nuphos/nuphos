export type RuntimeRequest = {
  waitId: string
  kind: string
  label?: string
  ref?: string
  clientTool?: { toolName: string; input?: unknown; streamId?: string }
  createdAt: number
}

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
  }[]
  actions?: { send: boolean; cancel: boolean; steer: boolean; reply?: boolean }
  epoch?: string
  revision?: number
  observedAt?: number
}

/** A transport, a buffered frame, and a tool card cannot authorize execution. */
export function runtimeIsExecuting(snapshot: RuntimeExecution | undefined): boolean {
  return (
    snapshot?.state === 'active' &&
    typeof snapshot.observedAt === 'number' &&
    performance.now() - snapshot.observedAt >= 0 &&
    performance.now() - snapshot.observedAt < 12_000
  )
}

/** A user-visible turn, including a queued or running automatic continuation. */
export function runtimeTurnActive(snapshot: RuntimeExecution | undefined): boolean {
  return runtimeIsExecuting(snapshot) && snapshot?.phase !== 'resume_disconnected'
}

/** The turn ended while runtime-owned background tools or tasks keep running. */
export function runtimeBackgroundRunning(snapshot: RuntimeExecution | undefined): boolean {
  return (
    !runtimeTurnActive(snapshot) &&
    runtimeSnapshotFresh(snapshot) &&
    snapshot?.schemaVersion === 2 &&
    snapshot.phase === 'background_tools'
  )
}

export type ChatRowIndicator = 'turn' | 'background' | 'unread' | 'none'

/** A running turn outranks background work, which outranks an unread reply. */
export function chatRowIndicator(
  snapshot: RuntimeExecution | undefined,
  unread: boolean,
): ChatRowIndicator {
  if (runtimeTurnActive(snapshot)) return 'turn'
  if (runtimeBackgroundRunning(snapshot)) return 'background'

  return unread ? 'unread' : 'none'
}

export function acceptRuntimeSnapshot(
  current: RuntimeExecution | undefined,
  next: RuntimeExecution,
): RuntimeExecution {
  if (
    current?.epoch &&
    current.epoch === next.epoch &&
    typeof current.revision === 'number' &&
    typeof next.revision === 'number' &&
    next.revision < current.revision
  )
    return current

  if (
    current &&
    typeof current.observedAt === 'number' &&
    typeof next.observedAt === 'number' &&
    next.observedAt < current.observedAt &&
    (current.epoch !== next.epoch || current.revision === next.revision)
  )
    return current

  return next
}

/** Select one observation, never OR execution flags from separate readers. */
export function newestRuntimeSnapshot(
  left: RuntimeExecution | undefined,
  right: RuntimeExecution | undefined,
): RuntimeExecution | undefined {
  if (!left) return right
  if (!right) return left
  if (
    left.epoch &&
    left.epoch === right.epoch &&
    typeof left.revision === 'number' &&
    typeof right.revision === 'number' &&
    left.revision !== right.revision
  ) {
    return left.revision > right.revision ? left : right
  }

  return (left.observedAt ?? -Infinity) > (right.observedAt ?? -Infinity) ? left : right
}

/** Observation freshness is a connection property, never a fabricated runtime transition. */
export function runtimeSnapshotFresh(snapshot: RuntimeExecution | undefined): boolean {
  return (
    typeof snapshot?.observedAt === 'number' &&
    performance.now() - snapshot.observedAt >= 0 &&
    performance.now() - snapshot.observedAt < 12_000
  )
}

export function runtimeAllows(
  snapshot: RuntimeExecution | undefined,
  action: 'send' | 'cancel' | 'steer' | 'reply',
): boolean {
  return (
    runtimeSnapshotFresh(snapshot) &&
    snapshot?.schemaVersion === 2 &&
    snapshot.actions?.[action] === true
  )
}

export function runtimeStatusLabel(snapshot: RuntimeExecution | undefined): string {
  if (!snapshot || !runtimeSnapshotFresh(snapshot) || snapshot.state === 'disconnected')
    return 'Connection lost — agent status unavailable'
  if (snapshot.schemaVersion !== 2) return 'Agent status unavailable — agent update required'

  return snapshot.label || `Agent: ${snapshot.phase || snapshot.state}`
}
