import { t } from '../../i18n/index.ts'

import type { QuotaTone } from '../../lib/runtimeQuota'
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
      ? { label: t('Deletion paused'), tone: 'error' }
      : { label: t('Deleting…'), tone: 'pending' }
  }
  if (instance.status !== 'active') return { label: t('Disabled'), tone: 'off' }
  if (runtime?.authenticated === false) return { label: t('Sign in required'), tone: 'pending' }
  if (runtime?.credentialRevoked) return { label: t('Connection revoked'), tone: 'error' }
  if (statusError) return { label: t('Status unavailable'), tone: 'error' }
  if (runtime?.online) return { label: t('Online'), tone: 'online' }
  // Nuphos runs a managed agent, so not answering yet means its pod is still starting.
  if (runtime?.configured)
    return instance.kind === 'managed'
      ? { label: t('Starting…'), tone: 'pending' }
      : { label: t('Unreachable'), tone: 'error' }

  return runtime
    ? { label: t('Starting…'), tone: 'pending' }
    : { label: t('Connecting…'), tone: 'pending' }
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

  if (days > 0) return t('{days}d {hours}h', { days, hours })
  if (hours > 0) return t('{hours}h {minutes}m', { hours, minutes })

  return t('{minutes}m', { minutes })
}

export type RuntimeMetricKey = 'cpuMillicores' | 'memoryBytes' | 'sessions' | 'diskUsedBytes'

/** The series with at least one reading in the window; an unknown one is not charted. */
export function reportedSeries<Series extends { key: RuntimeMetricKey }>(
  samples: RuntimeMetricSample[],
  series: readonly Series[],
): Series[] {
  return series.filter(({ key }) => samples.some((sample) => sample[key] !== null))
}

/** A draining usage bar is green while healthy, amber when it runs low and red once it is spent. */
export const QUOTA_FILL_CLASS: Record<QuotaTone, string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  exhausted: 'bg-error',
}

/** An empty bar has no fill left to colour, so its label carries the tone too. */
export const QUOTA_LABEL_CLASS: Record<QuotaTone, string> = {
  ok: '',
  warning: 'text-warning',
  exhausted: 'text-error',
}

/** What removing a runtime takes with it, for the confirmation. */
export function runtimeRemovalDescription(instance: RuntimeInstance): string {
  if (instance.kind === 'managed')
    return t(
      'This permanently deletes the runtime, its disks, workspaces, and sign-in, and stops agents running on it. Your agent history stays in Nuphos. Move any workspace you want to keep to another runtime before removing this one.',
    )
  const local = instance.local

  if (!local)
    return t(
      'This disconnects the external runtime. Its files remain on the external machine. Your agents stay in Nuphos and can be moved to another runtime with their history.',
    )
  if (local.instanceId)
    return t(
      'This removes the agent and its sign-in from {device}. Your conversation history stays in Nuphos.',
      { device: local.deviceLabel },
    )

  return instance.provider === 'codex'
    ? t(
        'This signs {name} out on {device} and deletes its settings there. Agents on it stop working; their history stays in Nuphos.',
        { name: instance.label, device: local.deviceLabel },
      )
    : t(
        'This signs {name} out on {device} and deletes its CLI history and settings there. Agents on it stop working; their history stays in Nuphos.',
        { name: instance.label, device: local.deviceLabel },
      )
}
