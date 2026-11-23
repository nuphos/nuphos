import { t } from '../../i18n/index.ts'
import { isThisComputer } from '../../lib/agentName.ts'
import { AGENT_PROVIDER } from '../../types/runtime.ts'

import type { AgentDevice, LocalAgentProvider } from '../../api/device-types'
import type { ThisComputer } from '../../lib/agentName.ts'
import type { LocalRuntimeSummary, RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/**
 * A person's own computer's default agent whose CLI is signed in. That computer's report
 * lists it whatever Nuphos forgets, so it cannot be removed while it stays signed in.
 */
export function ownSignedInCli(instance: RuntimeInstance): boolean {
  const local = instance.local

  return local !== undefined && !local.instanceId && !local.box && local.signedIn === true
}

/**
 * How a computer's agent is removed: an added one by its id, a default one by its provider
 * (as for rename). A person's own computer's default is their CLI login, so Nuphos only
 * forgets it, and only while that CLI is signed out; it shows again once it signs in (see
 * visibleAgent).
 */
export function localRemovalId(instance: RuntimeInstance): string | undefined {
  const local = instance.local

  if (!local || ownSignedInCli(instance)) return undefined
  if (instance.provider === 'antigravity' && !local.instanceId) return undefined

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

/**
 * A computer's agent goes by its own name, else its provider's; Runs on says which computer.
 * This is the name it is stored under, which Rename edits; lists show `agentDisplayName`.
 */
export function agentName(instance: RuntimeInstance): string {
  return instance.kind === 'local'
    ? (instance.local?.agentLabel ?? AGENT_PROVIDER[instance.provider].label)
    : instance.label
}

/** The number in the name a computer gives a later agent: the 2 of "Claude Code 2". */
const NUMBERED_DEFAULT = /^[2-9]\d*$/u

/**
 * A name a person gave the agent; undefined while it goes by the one its computer gave it —
 * its provider's, or that provider's name numbered, as `defaultAgentName` makes it. Rename can
 * write any name, so a name the computer gave is told from a chosen one by its shape alone.
 */
function agentNameOfPerson(agent: Pick<RuntimeInstance, 'provider' | 'local'>): string | undefined {
  const label = agent.local?.agentLabel

  if (!label) return undefined
  const base = AGENT_PROVIDER[agent.provider].label

  if (label === base) return undefined
  if (label.startsWith(`${base} `) && NUMBERED_DEFAULT.test(label.slice(base.length + 1)))
    return undefined

  return label
}

/**
 * What a list calls an agent: its name, or — on a computer holding more than one account for
 * its provider, where a name alone would not tell two of them apart — that and the account.
 * The account is only for an agent with no name of its own: the number its computer gave it is
 * not a person's choice, so it gives way to the account.
 */
export function agentDisplayName(
  instance: Pick<RuntimeInstance, 'label' | 'provider' | 'local'>,
): string {
  const local = instance.local

  if (!local) return instance.label

  return (
    agentNameOfPerson(instance) ??
    local.accountLabel ??
    local.agentLabel ??
    AGENT_PROVIDER[instance.provider].label
  )
}

/**
 * Shown offline: a computer's agent whose computer is away, or any agent its Usage reading
 * could not reach. Whether it can be picked for a conversation is the catalog's `notReady`.
 */
export function agentOffline(instance: RuntimeInstance, quota?: RuntimeQuota): boolean {
  return instance.local?.online === false || quota?.offline === true
}

/** The computer a local agent runs on: its owner's, as one machine can hold several accounts. */
const computerOf = (local?: LocalRuntimeSummary) =>
  local && { userId: local.ownerUserId, deviceId: local.deviceId }

export function agentRunsOn(
  instance: RuntimeInstance,
  here?: ThisComputer,
  quota?: RuntimeQuota,
): string {
  const local = instance.local
  let where = RUNS_ON[instance.kind]

  if (instance.kind === 'local') {
    where = local?.deviceLabel.trim() ? local.deviceLabel : t('Computer')
    if (isThisComputer(here ?? null, computerOf(local))) where = t('This computer')
  }

  if (instance.status !== 'active') return t('{where} · Disabled', { where })

  return agentOffline(instance, quota) ? t('{where} · Offline', { where }) : where
}

/** A member who may only use a machine sees it, not the controls the backend would refuse. */
export function canManage(device: Pick<AgentDevice, 'access'>): boolean {
  return device.access !== 'use'
}

/**
 * Whether the viewer renames, removes and signs in this runtime: a computer's agent answers to
 * those who manage its computer, as the computer list reports it, not to a team role
 * (box-access.ts); a team runtime to its admins. Until the list has the computer: no one.
 */
export function managesRuntime(
  instance: RuntimeInstance,
  device: Pick<AgentDevice, 'access'> | undefined,
  isAdmin: boolean,
): boolean {
  return instance.local ? device !== undefined && canManage(device) : isAdmin
}

/**
 * How an agent signs in while it is not signed in, for those who manage its computer
 * (managesRuntime). This computer's default Claude Code or Codex agent signs in through its CLI.
 * Any other agent, added or on another computer, signs in through the runtime sign-in, which
 * reaches exactly that agent (the CLI's login is only this computer's default agent's).
 */
export function localSignIn(
  instance: RuntimeInstance,
  thisComputer: ThisComputer,
): 'claude-code' | 'codex' | 'runtime' | undefined {
  const local = instance.local

  if (!local || local.signedIn === true) return undefined
  if (instance.provider !== 'claude-code' && instance.provider !== 'codex') return 'runtime'
  // An ended sign-in is renewed only through Nuphos, not by the CLI's own login.
  if (local.signInEnded) return 'runtime'

  return !local.instanceId && isThisComputer(thisComputer, computerOf(local))
    ? instance.provider
    : 'runtime'
}

/**
 * What New Agent does for a provider: sign in the machine's signed-out one first, so a lapsed
 * sign-in never turns into a second agent; else add an agent. An older host is the backend's to
 * refuse: the agents a computer lists say nothing about what its host can do.
 */
export function newAgentAction(
  agents: RuntimeInstance[],
  provider: LocalAgentProvider,
): { create: true } | { signIn: string } | null {
  const idle = agents.find((agent) => agent.provider === provider && agent.local?.signedIn !== true)

  if (idle) return { signIn: idle.id }

  // Native keyring sign-in is shared; another home does not create another account.
  return provider === 'antigravity' ? null : { create: true }
}

/** Whose account a computer's agent runs as: whoever signed it in through Nuphos. */
export function signedInAs(name: string, signerId: string, viewerId: string | undefined): string {
  return signerId === viewerId ? t('Signed in as you') : t('Signed in as {name}', { name })
}
