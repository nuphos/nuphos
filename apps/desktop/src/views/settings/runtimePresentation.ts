import type { RuntimeInstance, RuntimeMetricSample } from '../../types/runtime'
import type { OpenAbRuntimeStatus } from '../../types/team'

export type RuntimeStatusTone = 'online' | 'pending' | 'off' | 'error'
export type RuntimeStatusView = { label: string; tone: RuntimeStatusTone }

export const STATUS_DOT: Record<RuntimeStatusTone, string> = {
  online: 'bg-emerald-500',
  pending: 'bg-amber-500',
  off: 'bg-zGray-600',
  error: 'bg-red-500',
}

export function runtimeStatusView(
  instance: RuntimeInstance,
  runtime: OpenAbRuntimeStatus | null,
  statusError: boolean,
): RuntimeStatusView {
  if (instance.deletion) {
    return instance.deletion.error
      ? { label: 'Deletion paused', tone: 'error' }
      : { label: 'Deleting…', tone: 'pending' }
  }
  if (instance.status !== 'active') return { label: 'Disabled', tone: 'off' }
  if (runtime?.authenticated === false) return { label: 'Sign in required', tone: 'pending' }
  if (runtime?.credentialRevoked) return { label: 'Connection revoked', tone: 'error' }
  if (statusError) return { label: 'Status unavailable', tone: 'error' }
  if (runtime?.online) return { label: 'Online', tone: 'online' }
  // Nuphos runs a managed agent, so not answering yet means its pod is still starting.
  if (runtime?.configured)
    return instance.kind === 'managed'
      ? { label: 'Starting…', tone: 'pending' }
      : { label: 'Unreachable', tone: 'error' }

  return runtime
    ? { label: 'Starting…', tone: 'pending' }
    : { label: 'Connecting…', tone: 'pending' }
}

/** `…/nuphos-openab-runtime:0d6d5c8-1@sha256:8324d1…` → `0d6d5c8-1 (8324d13)`. */
export function imageVersion(image: string): string {
  const [ref, digest] = image.split('@sha256:')
  const name = ref?.slice(ref.lastIndexOf('/') + 1) ?? ''
  const tag = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name

  return digest ? `${tag} (${digest.slice(0, 7)})` : tag
}

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)

  if (days > 0) return `${String(days)}d ${String(hours)}h`
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`

  return `${String(minutes)}m`
}

export type RuntimeMetricKey = 'cpuMillicores' | 'memoryBytes' | 'sessions' | 'diskUsedBytes'

/** The series with at least one reading in the window; an unknown one is not charted. */
export function reportedSeries<Series extends { key: RuntimeMetricKey }>(
  samples: RuntimeMetricSample[],
  series: readonly Series[],
): Series[] {
  return series.filter(({ key }) => samples.some((sample) => sample[key] !== null))
}
