export type AgentCommand = { name: string; description: string; hint?: string }

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
  /** The agent's own slash commands (ACP `available_commands_update`), as the runtime last saw them. */
  commands?: AgentCommand[]
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

// The list rides on every runtime_state push and in the list cache, so it stays
// small: at most 100 entries of about 360 characters each.
const MAX_COMMANDS = 100
const MAX_DESCRIPTION = 200
const MAX_HINT = 100
// What a client inserts as `/<name> `: no spaces, nothing that could start markup.
const COMMAND_NAME = /^\w[\w:.-]{0,63}$/

// The list is the agent's to define, so it is only shaped here: an unusable or
// repeated entry is dropped and long text is cut, never the whole snapshot.
function sanitizeCommands(value: unknown): AgentCommand[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || seen.size >= MAX_COMMANDS) return []
    const { name, description, hint } = entry as Record<string, unknown>

    if (typeof name !== 'string' || !COMMAND_NAME.test(name) || seen.has(name)) return []
    seen.add(name)

    return [
      {
        name,
        description: typeof description === 'string' ? description.slice(0, MAX_DESCRIPTION) : '',
        ...(typeof hint === 'string' && hint.trim() ? { hint: hint.slice(0, MAX_HINT) } : {}),
      },
    ]
  })
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
  const commands = sanitizeCommands(value.commands)

  if (commands) value.commands = commands
  else delete value.commands

  // Validate the wire contract, but never reconstruct or own its session state here.
  return value as SessionExecutionState
}
