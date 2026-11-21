// What a runtime's `session/update` carries in `_meta` about where a result came from and
// what state its thread is in.

const AUTONOMOUS_RESULT_ORIGINS = new Set([
  'task-notification',
  'peer',
  'coordinator',
  'observer',
  'observer-activity',
])

export function autonomousResultOrigin(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const meta = payload._meta

  if (!meta || typeof meta !== 'object') return null
  const origin = (meta as Record<string, unknown>)['_claude/origin']

  if (!origin || typeof origin !== 'object') return null
  const kind = (origin as Record<string, unknown>).kind

  return typeof kind === 'string' && AUTONOMOUS_RESULT_ORIGINS.has(kind)
    ? (origin as Record<string, unknown>)
    : null
}

export function runtimeThreadStatus(payload: Record<string, unknown>): string | null {
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
