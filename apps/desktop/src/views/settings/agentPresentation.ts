import { AGENT_PROVIDER } from '../../types/runtime.ts'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

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

/** A computer's agent goes by its own name, else its provider's; Runs on says which computer. */
export function agentName(instance: RuntimeInstance): string {
  return instance.kind === 'local'
    ? (instance.local?.agentLabel ?? AGENT_PROVIDER[instance.provider].label)
    : instance.label
}

/**
 * Shown offline: a computer's agent whose computer is away, or any agent its Usage reading
 * could not reach. Whether it can be picked for a conversation is the catalog's `notReady`.
 */
export function agentOffline(instance: RuntimeInstance, quota?: RuntimeQuota): boolean {
  return instance.local?.online === false || quota?.offline === true
}

export function agentRunsOn(
  instance: RuntimeInstance,
  currentDeviceId?: string,
  quota?: RuntimeQuota,
): string {
  const local = instance.local
  let where = RUNS_ON[instance.kind]

  if (instance.kind === 'local') {
    where = local?.deviceLabel.trim() ? local.deviceLabel : 'Computer'
    if (currentDeviceId && local?.deviceId === currentDeviceId) where = 'This computer'
  }

  if (instance.status !== 'active') return `${where} · Disabled`

  return agentOffline(instance, quota) ? `${where} · Offline` : where
}
