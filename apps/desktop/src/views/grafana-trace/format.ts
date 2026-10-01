export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '-'
  if (ms < 1) return `${String(Math.round(ms * 1000))}us`
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`
  const sec = ms / 1000

  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`

  return `${(sec / 60).toFixed(1)}m`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms))
}

export function formatAttribute(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return Object.prototype.toString.call(value)
  }
}
