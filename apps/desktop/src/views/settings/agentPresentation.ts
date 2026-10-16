import { AGENT_PROVIDER } from '../../types/runtime.ts'

import type { RuntimeInstance } from '../../types/runtime'

/**
 * How a computer's agent is removed: an added one by its id, a Box's default one as
 * default-<provider>. A person's own computer keeps its defaults (they are its CLIs'
 * logins), so it has none to offer.
 */
export function localRemovalId(instance: RuntimeInstance): string | undefined {
  const local = instance.local

  if (!local) return undefined

  return local.instanceId ?? (local.box ? `default-${instance.provider}` : undefined)
}

/** The overview shows local providers only after sign-in; team runtimes remain visible. */
export function visibleAgent(instance: RuntimeInstance): boolean {
  return instance.kind !== 'local' || instance.local?.signedIn === true
}

const RUNS_ON: Record<RuntimeInstance['kind'], string> = {
  managed: 'Cloud',
  external: 'Self-hosted',
  development: 'Development',
  local: 'Computer',
}

/** A computer's agent is named by its provider; Runs on says which computer. */
export function agentName(instance: RuntimeInstance): string {
  return instance.kind === 'local' ? AGENT_PROVIDER[instance.provider].label : instance.label
}

/** A computer's agent whose computer is away: still listed, shown offline. */
export function agentOffline(instance: RuntimeInstance): boolean {
  return instance.local?.online === false
}

export function agentRunsOn(instance: RuntimeInstance, currentDeviceId?: string): string {
  const local = instance.local
  let where = RUNS_ON[instance.kind]

  if (instance.kind === 'local') {
    where = local?.deviceLabel.trim() ? local.deviceLabel : 'Computer'
    if (currentDeviceId && local?.deviceId === currentDeviceId) where = 'This computer'
  }

  if (instance.status !== 'active') return `${where} · Disabled`

  return agentOffline(instance) ? `${where} · Offline` : where
}
