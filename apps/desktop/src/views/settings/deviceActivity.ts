import type { DeviceExecAuditEntry, DeviceExecOrigin } from '../../api/device-types.ts'

export type OutcomeTone = 'success' | 'warning' | 'error' | 'muted'

const ORIGIN_LABELS: Record<DeviceExecOrigin, string> = {
  user: 'You',
  trigger: 'Trigger',
  automation: 'Scheduled task',
  'database-alert': 'Database alert',
}

export function originLabel(origin: DeviceExecOrigin): string {
  return ORIGIN_LABELS[origin]
}

export function outcomeSummary(entry: Pick<DeviceExecAuditEntry, 'outcome' | 'exitCode'>): {
  label: string
  tone: OutcomeTone
} {
  switch (entry.outcome) {
    case 'ok':
      return entry.exitCode === 0
        ? { label: 'Exit 0', tone: 'success' }
        : { label: `Exit ${String(entry.exitCode ?? '?')}`, tone: 'warning' }
    case 'timeout':
      return { label: 'Timed out', tone: 'error' }
    case 'device_offline':
      return { label: 'Device offline', tone: 'error' }
    case 'rejected':
      return { label: 'Not run', tone: 'muted' }
    case 'error':
      return { label: 'Failed', tone: 'error' }
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.max(0, Math.round(ms)))} ms`
  const seconds = ms / 1000

  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  const whole = Math.round(seconds)

  return `${String(Math.floor(whole / 60))}m ${String(whole % 60).padStart(2, '0')}s`
}

export const COMMAND_PREVIEW_CHARS = 80

export function commandPreview(
  command: string,
  max = COMMAND_PREVIEW_CHARS,
): { text: string; truncated: boolean } {
  const firstLine = command.split('\n', 1)[0] ?? ''
  const multiline = firstLine.length < command.length

  if (firstLine.length <= max && !multiline) return { text: command, truncated: false }

  return { text: `${firstLine.slice(0, max).trimEnd()}…`, truncated: true }
}

export function formatActivityTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const diffMs = now.getTime() - at.getTime()

  if (Number.isNaN(at.getTime())) return ''
  if (diffMs < 60_000) return 'Just now'
  if (diffMs < 3_600_000) return `${String(Math.floor(diffMs / 60_000))}m ago`
  if (diffMs < 86_400_000) return `${String(Math.floor(diffMs / 3_600_000))}h ago`

  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
