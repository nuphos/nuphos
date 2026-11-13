import { AGENT_PROVIDER } from '../types/runtime.ts'

import type { LocalAgentProvider, LocalRuntimeState } from '../api/device-types.ts'
import type { AgentProvider, RuntimeInstance } from '../types/runtime.ts'

/** How much of an account fits beside an agent's name before it is shortened. */
export const ACCOUNT_LABEL_MAX = 36

/** Between the agent's name and the account it is signed in as. */
export const ACCOUNT_LABEL_SEPARATOR = ' · '

/** An agent's account on the computer it runs on, as that computer reports it. */
export type AccountOnComputer = { provider: AgentProvider; account?: string }

/**
 * What an agent goes by when its computer holds more than one account for its provider: the
 * provider's name and that account, so two of them are told apart by which one they use rather
 * than by a number. Left out otherwise — one account tells nothing apart — and an agent whose
 * account its computer has not reported keeps the name it already has.
 */
export function accountLabel(
  agent: AccountOnComputer,
  onComputer: readonly AccountOnComputer[],
): string | undefined {
  const account = shortAccount(agent.account)

  if (!account || distinctAccounts(agent.provider, onComputer) < 2) return undefined

  return `${AGENT_PROVIDER[agent.provider].label}${ACCOUNT_LABEL_SEPARATOR}${account}`
}

/** How many accounts of one provider a computer's agents are known to be signed in to. */
function distinctAccounts(
  provider: AgentProvider,
  onComputer: readonly AccountOnComputer[],
): number {
  const accounts = onComputer.flatMap((agent) => {
    if (agent.provider !== provider) return []
    const account = shortAccount(agent.account)

    return account ? [account.toLocaleLowerCase()] : []
  })

  return new Set(accounts).size
}

/** An account as one short line: the CLI's own text, its whitespace collapsed, cut to fit. */
export function shortAccount(account: string | undefined): string | undefined {
  const oneLine = account?.replace(/\s+/gu, ' ').trim()

  if (!oneLine) return undefined

  return oneLine.length > ACCOUNT_LABEL_MAX
    ? `${oneLine.slice(0, ACCOUNT_LABEL_MAX - 1)}…`
    : oneLine
}

/** The providers this app signs in itself; a catalog also carries ones only Nuphos runs. */
function localProvider(provider: AgentProvider): LocalAgentProvider | undefined {
  return provider === 'antigravity' || provider === 'hermes' ? undefined : provider
}

/**
 * The account this computer reports for one of its own agents: the default agent's CLI login, or
 * the one an added agent signed in as. Undefined for any other agent — another computer's,
 * a teammate's, or one whose host has not said — which leaves its name as it is.
 */
export function accountOnComputer(
  state: LocalRuntimeState | null,
  instance: RuntimeInstance,
): string | undefined {
  const local = instance.local
  const provider = localProvider(instance.provider)

  if (!state?.userId || !state.deviceId || !local || !provider) return undefined
  if (local.ownerUserId !== state.userId || local.deviceId !== state.deviceId) return undefined

  const cli = local.instanceId
    ? state.instances?.find((entry) => entry.instanceId === local.instanceId)?.cli
    : state.agents[provider].cli

  return cli?.installed ? cli.account : undefined
}

/**
 * The catalog's agents, with this computer's own ones labelled by account. The label is worked
 * out here and shown here: it is never stored, and never part of what a computer sends to the
 * backend, so no other member of the team can see whose account an agent runs on.
 */
export function withAccountLabels(
  instances: readonly RuntimeInstance[],
  state: LocalRuntimeState | null,
): RuntimeInstance[] {
  const mine = instances.flatMap((instance) => {
    const account = accountOnComputer(state, instance)

    return account === undefined ? [] : [{ instance, account }]
  })
  const accounts = new Map(mine.map(({ instance, account }) => [instance.id, account]))
  const onComputer = mine.map(({ instance, account }) => ({
    provider: instance.provider,
    account,
  }))

  return instances.map((instance) => {
    const account = accounts.get(instance.id)
    const label =
      account === undefined
        ? undefined
        : accountLabel({ provider: instance.provider, account }, onComputer)
    const local = instance.local

    if (!label || !local) return instance

    return { ...instance, local: { ...local, accountLabel: label } }
  })
}
