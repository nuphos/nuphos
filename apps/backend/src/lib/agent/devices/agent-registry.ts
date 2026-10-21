import type { LocalAgentProvider, LocalRuntimeStatus } from './local-runtime/protocol'

/** An agent a computer once reported signed in. It stays listed, online or not,
 *  until it is removed; presence only says whether it is reachable right now. */
export type RegisteredAgent = {
  provider: LocalAgentProvider
  /** Absent for the computer's own default agent of that provider. */
  instanceId?: string
  /** The name a person gave it; a report only names an agent that joins without one. */
  label?: string
  /** What the computer last reported; kept while it is offline. */
  signedIn: boolean | null
}

/** Who added an agent to a computer through Nuphos, and when; only those agents have one. */
export type AgentAddition = { instanceId: string; userId: string; at: Date }

export const registryKey = (agent: Pick<RegisteredAgent, 'provider' | 'instanceId'>) =>
  agent.instanceId ?? agent.provider

/** An agent as a report shows it now. Once registered, its name is the registry's alone:
 *  a report names only an agent that joins, so a cleared name stays cleared. */
export function withReport(
  known: RegisteredAgent | undefined,
  reported: RegisteredAgent,
): RegisteredAgent {
  if (!known) return reported
  const { label: _reported, ...rest } = reported

  return { ...known, ...rest }
}

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

/** Registered agents get the latest report, but keep their name; an agent seen signed in
 *  for the first time joins. Nothing leaves here. Returns null when nothing changed. */
export function mergeAgentRegistry(
  registered: RegisteredAgent[],
  reported: RegisteredAgent[],
): RegisteredAgent[] | null {
  const merged = new Map(registered.map((agent) => [registryKey(agent), agent]))

  for (const agent of reported) {
    const key = registryKey(agent)
    const known = merged.get(key)

    if (known || agent.signedIn === true) merged.set(key, withReport(known, agent))
  }
  const next = [...merged.values()]

  return JSON.stringify(next) === JSON.stringify(registered) ? null : next
}

/** Names a registered agent; an empty label gives it back its default name.
 *  Returns null when no such agent is registered. */
export function renameRegisteredAgent(
  registered: RegisteredAgent[],
  key: string,
  label: string,
): RegisteredAgent[] | null {
  if (!registered.some((agent) => registryKey(agent) === key)) return null

  return registered.map((agent) => {
    if (registryKey(agent) !== key) return agent
    const { label: _previous, ...rest } = agent

    return label ? { ...rest, label } : rest
  })
}

/** Long enough for a create to reach the host after its addition was noted. */
export const ADDITION_GRACE_MS = 10 * 60_000

/**
 * The instances whose addition can go: neither registered nor on a report from a host that
 * lists its agents (pending ones too). A host may drop a pending agent itself, so this is what
 * keeps the bounded list for live agents. Empty when nothing is to go.
 */
export function goneAdditions(
  additions: AgentAddition[],
  registered: RegisteredAgent[],
  status: LocalRuntimeStatus | undefined,
  now = Date.now(),
): string[] {
  if (!status?.instances) return []
  const live = new Set([
    ...registered.map((agent) => agent.instanceId),
    ...status.instances.map((instance) => instance.instanceId),
  ])

  return additions
    .filter((entry) => !live.has(entry.instanceId) && now - entry.at.getTime() >= ADDITION_GRACE_MS)
    .map((entry) => entry.instanceId)
}
