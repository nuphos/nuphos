export type SessionExecutionState = {
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
  requests?: {
    waitId: string
    kind: string
    label?: string
    ref?: string
    clientTool?: { toolName: string; input?: unknown; streamId?: string }
    createdAt: number
  }[]
  permissionWaits?: number
  tools?: {
    id: string
    status?: string
    title?: string
    kind?: string
    // Set once openab observes a `ToolCallContent::Terminal` embed on this
    // tool's session/update stream (shells-panel Phase 1: openab#41).
    terminal?: {
      terminalId: string
      command?: string
      output?: string
      status: 'running' | 'exited'
      exit?: { exitCode?: number | null; signal?: string | null }
    }
  }[]
  actions?: { send: boolean; cancel: boolean; steer: boolean; reply?: boolean }
  epoch?: string
  revision?: number
}

function isValidToolTerminal(terminal: unknown): boolean {
  if (!terminal || typeof terminal !== 'object') return false
  const t = terminal as Record<string, unknown>

  if (typeof t.terminalId !== 'string' || !t.terminalId) return false
  if (t.status !== 'running' && t.status !== 'exited') return false
  if (t.command !== undefined && typeof t.command !== 'string') return false
  if (t.output !== undefined && typeof t.output !== 'string') return false

  return t.exit === undefined || (typeof t.exit === 'object' && t.exit !== null)
}

// A malformed `terminal` embed on one tool is that tool's problem, not the
// whole snapshot's: drop just the bad field so unrelated live tools survive.
function sanitizeToolTerminal(tool: Record<string, unknown>): Record<string, unknown> {
  if (tool.terminal === undefined || isValidToolTerminal(tool.terminal)) return tool
  const { terminal: _terminal, ...rest } = tool

  return rest
}

export function parseSessionExecutionState(value: Record<string, unknown>): SessionExecutionState {
  if (value.state === 'dormant' && value.schemaVersion !== 2) return { state: 'dormant' }
  if (
    !['active', 'idle', 'dormant', 'interrupted', 'unknown'].includes(String(value.state)) ||
    typeof value.epoch !== 'string' ||
    !value.epoch ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    throw new Error('Invalid runtime execution snapshot')

  if (value.schemaVersion === 2) {
    const actions = value.actions as Record<string, unknown> | undefined

    if (
      typeof value.phase !== 'string' ||
      typeof value.label !== 'string' ||
      !actions ||
      ['send', 'cancel', 'steer'].some((key) => typeof actions[key] !== 'boolean') ||
      !Array.isArray(value.tools)
    )
      throw new Error('Invalid runtime lifecycle snapshot')

    value.tools = value.tools.map((tool) => sanitizeToolTerminal(tool as Record<string, unknown>))
  }

  // Validate the wire contract, but never reconstruct or own its session state here.
  return value as SessionExecutionState
}
