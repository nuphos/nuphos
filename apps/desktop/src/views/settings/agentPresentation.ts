import type { RuntimeInstance } from '../../types/runtime'

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

export function agentRunsOn(instance: RuntimeInstance, currentDeviceId?: string): string {
  const local = instance.local
  let where = RUNS_ON[instance.kind]

  if (instance.kind === 'local') {
    where = local?.deviceLabel.trim() ? local.deviceLabel : 'Computer'
    if (currentDeviceId && local?.deviceId === currentDeviceId) where = 'This computer'
  }

  return instance.status === 'active' ? where : `${where} · Disabled`
}
