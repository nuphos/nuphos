import type { LocalAgentProvider, LocalRuntimeStatus } from './local-runtime/protocol'

/** An agent a computer once reported signed in. It stays listed, online or not,
 *  until it is removed; presence only says whether it is reachable right now. */
export type RegisteredAgent = {
  provider: LocalAgentProvider
  /** Absent for the computer's own default agent of that provider. */
  instanceId?: string
  label?: string
  /** What the computer last reported; kept while it is offline. */
  signedIn: boolean | null
}

export const registryKey = (agent: Pick<RegisteredAgent, 'provider' | 'instanceId'>) =>
  agent.instanceId ?? agent.provider

/** What one status report says about each agent, pending sign-ins excluded. */
export function reportedAgents(status: LocalRuntimeStatus | undefined): RegisteredAgent[] {
  if (!status) return []

  return [
    ...Object.entries(status.agents).flatMap(([provider, agent]) =>
      agent ? [{ provider: provider as LocalAgentProvider, signedIn: agent.cli.loggedIn }] : [],
    ),
    ...(status.instances ?? [])
      .filter((instance) => instance.state !== 'pending')
      .map(({ provider, instanceId, label, cli }) => ({
        provider,
        instanceId,
        label,
        signedIn: cli.loggedIn,
      })),
  ]
}

/** Registered agents get the latest report; an agent seen signed in for the first time
 *  joins. Nothing leaves here. Returns null when nothing changed. */
export function mergeAgentRegistry(
  registered: RegisteredAgent[],
  reported: RegisteredAgent[],
): RegisteredAgent[] | null {
  const merged = new Map(registered.map((agent) => [registryKey(agent), agent]))

  for (const agent of reported) {
    const key = registryKey(agent)

    if (merged.has(key) || agent.signedIn === true)
      merged.set(key, { ...merged.get(key), ...agent })
  }
  const next = [...merged.values()]

  return JSON.stringify(next) === JSON.stringify(registered) ? null : next
}
