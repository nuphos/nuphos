export type HealthTone = 'success' | 'warning' | 'error' | 'neutral'

export const healthClass: Record<HealthTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  neutral: 'text-secondary',
}

export function k8sStatusTone(status: string): HealthTone {
  const s = status
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')

  if (['complete', 'completed', 'succeeded', 'suspended', 'scaledtozero'].includes(s))
    return 'neutral'
  if (
    /error|errimagepull|crash|fail|backoff|oom|evict|invalid|unschedulable|nodelost|outof|exceed|deadline|notready|cannot|unexpectedadmission|shutdown|exitcode:[1-9]|signal:[1-9]/.test(
      s,
    )
  )
    return 'error'
  if (['running', 'ready', 'available', 'healthy'].includes(s)) return 'success'

  // Unknown/custom reasons must never imply health or successful completion.
  return 'warning'
}

export function parseReadiness(value: string): [number, number] | null {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim())

  return match ? [Number(match[1]), Number(match[2])] : null
}

export function replicaTone(ready: number, desired: number): HealthTone {
  if (!Number.isFinite(ready) || !Number.isFinite(desired) || ready < 0 || desired < 0)
    return 'warning'
  if (desired === 0) return ready === 0 ? 'neutral' : 'warning'
  if (ready === 0) return 'error'

  return ready === desired ? 'success' : 'warning'
}

export function readinessTone(value: string): HealthTone {
  const counts = parseReadiness(value)

  return counts ? replicaTone(...counts) : 'warning'
}

export function podTone(status: string, ready: string): HealthTone {
  const tone = k8sStatusTone(status)

  // Terminal success and explicit faults override the container counts.
  // Pending/init/termination are transitions, not outages inferred from 0/N.
  return tone === 'success' ? readinessTone(ready) : tone
}
