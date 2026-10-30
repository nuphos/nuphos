import { t } from '../../i18n/index.ts'
import { AGENT_PROVIDER } from '../../types/runtime.ts'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/**
 * How a computer's agent is removed: an added one by its id, a Box's default one by its
 * provider (as for rename). A person's own computer keeps its defaults (they are its CLIs'
 * logins), so it has none to offer.
 */
export function localRemovalId(instance: RuntimeInstance): string | undefined {
  const local = instance.local

  if (!local) return undefined

  return local.instanceId ?? (local.box ? instance.provider : undefined)
}

/**
 * A computer's agent shows once it has signed in, and stays when it signs out so it can sign
 * in again. A default agent no one used, or a sign-in that failed, never shows.
 */
export function visibleAgent(instance: RuntimeInstance): boolean {
  return (
    instance.kind !== 'local' ||
    instance.local?.signedIn === true ||
    instance.local?.everSignedIn === true
  )
}

const RUNS_ON: Record<RuntimeInstance['kind'], string> = {
  managed: t('Cloud'),
  external: t('Self-hosted'),
  development: t('Development'),
  local: t('Computer'),
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
    where = local?.deviceLabel.trim() ? local.deviceLabel : t('Computer')
    if (currentDeviceId && local?.deviceId === currentDeviceId) where = t('This computer')
  }

  if (instance.status !== 'active') return t('{where} · Disabled', { where })

  return agentOffline(instance, quota) ? t('{where} · Offline', { where }) : where
}

/**
 * The CLI to sign in to right here, for this computer's own Claude Code or Codex agent while it
 * is not signed in. Another computer's agent signs in on that computer.
 */
export function thisComputerSignIn(
  instance: RuntimeInstance,
  thisComputer: { userId: string; deviceId: string } | null,
): 'claude-code' | 'codex' | undefined {
  const local = instance.local

  if (!local || local.instanceId || local.signedIn === true) return undefined
  if (local.deviceId !== thisComputer?.deviceId || local.ownerUserId !== thisComputer.userId)
    return undefined

  return instance.provider === 'claude-code' || instance.provider === 'codex'
    ? instance.provider
    : undefined
}
