export function formatAge(iso: string | null): string {
  if (!iso) return '-'
  const then = new Date(iso).getTime()

  if (Number.isNaN(then)) return '-'
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))

  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    const m = minutes % 60

    return m > 0 ? `${String(hours)}h ${String(m)}m` : `${String(hours)}h`
  }
  const days = Math.floor(hours / 24)

  if (days < 30) {
    const h = hours % 24

    return h > 0 ? `${String(days)}d ${String(h)}h` : `${String(days)}d`
  }
  const months = Math.floor(days / 30)

  return `${String(months)}mo`
}

export function formatCpu(milli: number | null): string {
  if (milli == null) return '-'
  if (milli < 1000) return `${String(milli)}m`

  return (milli / 1000).toFixed(2)
}

export function formatMemory(bytes: number | null): string {
  if (bytes == null) return '-'
  const Mi = bytes / (1024 * 1024)

  if (Mi < 1024) return `${String(Math.round(Mi))} Mi`

  return `${(Mi / 1024).toFixed(1)} Gi`
}

export function statusColor(status: string): string {
  const s = status.toLowerCase()

  if (s === 'running' || s === 'ready' || s === 'active' || s === 'connected') {
    return 'text-success'
  }
  if (s === 'completed' || s === 'succeeded' || s === 'terminated') {
    return 'text-secondary'
  }
  if (
    s.includes('error') ||
    s.includes('crash') ||
    s.includes('fail') ||
    s.includes('backoff') ||
    s === 'notready'
  ) {
    return 'text-error'
  }
  if (
    s.includes('pending') ||
    s.includes('waiting') ||
    s.includes('progress') ||
    s.includes('terminating') ||
    s.includes('reconcil')
  ) {
    return 'text-warning'
  }
  // Better Stack statuses (monitors / incidents / telemetry sources)
  if (s === 'up' || s === 'ingesting' || s === 'resolved') {
    return 'text-success'
  }
  if (s === 'down' || s === 'ongoing' || s === 'started') {
    return 'text-error'
  }
  if (s === 'acknowledged' || s === 'maintenance' || s === 'validating') {
    return 'text-warning'
  }

  return 'text-secondary'
}
