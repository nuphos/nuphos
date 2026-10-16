import type { LocalRuntimeSummary } from '../types/runtime.ts'

export type ThisComputer = { userId: string; deviceId: string } | null

/** Local: this computer. Remote: the owner's other computers. Cloud: the team's agents. */
export type AgentTier = 'local' | 'remote' | 'cloud'

type NamedAgent = { id?: string; label: string; local?: LocalRuntimeSummary }

const LOCAL_ID = /^local_([A-Za-z0-9-]+)_([A-Za-z0-9-]+)(?:_codex)?$/u

function localRef(agent: NamedAgent): { userId: string; deviceId: string } | null {
  if (agent.local) return { userId: agent.local.ownerUserId, deviceId: agent.local.deviceId }
  const match = agent.id ? LOCAL_ID.exec(agent.id) : null

  return match?.[1] && match[2] ? { userId: match[1], deviceId: match[2] } : null
}

export function agentTier(agent: NamedAgent, owner: ThisComputer): AgentTier {
  const ref = localRef(agent)

  if (!ref) return 'cloud'

  return ref.userId === owner?.userId && ref.deviceId === owner.deviceId ? 'local' : 'remote'
}

/**
 * The one name for an agent everywhere it is shown. A local agent is named for
 * its computer — "Local" on this one — and its provider is the subtitle.
 */
export function agentName(agent: NamedAgent, owner: ThisComputer): string {
  const tier = agentTier(agent, owner)

  if (tier === 'cloud') return agent.label
  if (tier === 'local') return agent.label

  return agent.label
}

export type AgentTierGroup<T> = { tier: AgentTier; title: string; agents: T[] }

/** Picker sections in display order; empty sections are left out. */
export function groupAgentsByTier<T extends NamedAgent>(
  agents: readonly T[],
  _owner: ThisComputer,
): AgentTierGroup<T>[] {
  // Every machine is a Box now: one list, no This Computer / Remote / Cloud split.
  return agents.length ? [{ tier: 'local' as const, title: '', agents: [...agents] }] : []
}

/** An agent that isn't ready can't be picked, so the picker leaves it out; the current one stays. */
export function listedAgents<T extends { id?: string; notReady?: boolean }>(
  agents: readonly T[],
  selectedId: string | undefined,
): T[] {
  return agents.filter((agent) => !agent.notReady || agent.id === selectedId)
}

type SelectableAgent = NamedAgent & { status: 'active' | 'disabled' }

function usable(agent: SelectableAgent): boolean {
  return agent.status === 'active' && agent.local?.signedIn !== false
}

/** A new conversation starts on the usable agent with the most quota left; unknown counts as full. */
export function defaultAgent<T extends SelectableAgent & { id: string }>(
  agents: readonly T[],
  _owner: ThisComputer,
  usedPercent: (agent: T) => number | undefined = () => {},
): T | undefined {
  let best: T | undefined
  let bestUsed = Infinity

  for (const agent of agents) {
    if (!usable(agent)) continue
    const used = usedPercent(agent) ?? 0

    if (used < bestUsed) {
      best = agent
      bestUsed = used
    }
  }

  return best
}
