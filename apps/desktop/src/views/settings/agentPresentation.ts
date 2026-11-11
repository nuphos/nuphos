import { t } from '../../i18n/index.ts'
import { AGENT_PROVIDER } from '../../types/runtime.ts'

import type { LocalAgentProvider } from '../../api/device-types'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/**
 * How a computer's agent is removed: an added one by its id, a default one by its provider
 * (as for rename). A person's own computer's default is their CLI login, so Nuphos only
 * forgets it; it shows again once that CLI is signed in (see visibleAgent).
 */
export function localRemovalId(instance: RuntimeInstance): string | undefined {
  const local = instance.local

  if (!local || (instance.provider === 'antigravity' && !local.instanceId)) return undefined

  return local.instanceId ?? instance.provider
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
 * How the viewer signs in one of their own computers' agents while it is not signed in. This
 * computer's default Claude Code or Codex agent signs in through its CLI. Any other agent, added
 * or on another computer, signs in through the runtime sign-in, which reaches exactly that agent
 * (the CLI's login is only this computer's default agent's). Someone else's agent: none.
 */
export function localSignIn(
  instance: RuntimeInstance,
  thisComputer: { userId: string; deviceId: string } | null,
): 'claude-code' | 'codex' | 'runtime' | undefined {
  const local = instance.local

  if (!local || local.signedIn === true || local.ownerUserId !== thisComputer?.userId)
    return undefined
  if (instance.provider !== 'claude-code' && instance.provider !== 'codex') return 'runtime'

  return !local.instanceId && local.deviceId === thisComputer.deviceId
    ? instance.provider
    : 'runtime'
}

/**
 * What New Agent does for a provider: sign in the machine's signed-out one first, so a lapsed
 * sign-in never turns into a second agent; else add an agent when the host can.
 */
export function newAgentAction(
  agents: RuntimeInstance[],
  provider: LocalAgentProvider,
): { create: true } | { signIn: string } | null {
  const idle = agents.find((agent) => agent.provider === provider && agent.local?.signedIn !== true)

  if (idle) return { signIn: idle.id }
  // Native keyring sign-in is shared; another home does not create another account.
  if (provider === 'antigravity') return null

  return agents.some((agent) => agent.local?.agentInstances === true) ? { create: true } : null
}
