import type { LocalRuntimeSummary } from '../types/runtime.ts'

export type ThisComputer = { userId: string; deviceId: string } | null

/** Local: this computer. Remote: the owner's other computers. Cloud: the team's agents. */
export type AgentTier = 'local' | 'remote' | 'cloud'

type NamedAgent = { id?: string; label: string; local?: LocalRuntimeSummary }

const LOCAL_ID = /^local_([A-Za-z0-9-]+)_([A-Za-z0-9-]+)(?:_codex)?$/u
const PROVIDER_SUFFIX = / · (?:Claude Code|Codex)$/u

function localRef(agent: NamedAgent): { userId: string; deviceId: string } | null {
  if (agent.local) return { userId: agent.local.ownerUserId, deviceId: agent.local.deviceId }
  const match = agent.id ? LOCAL_ID.exec(agent.id) : null

  return match?.[1] && match[2] ? { userId: match[1], deviceId: match[2] } : null
}

export function agentTier(agent: NamedAgent, owner: ThisComputer): AgentTier {
  const ref = localRef(agent)

  if (!ref) return 'cloud'

  return owner && ref.userId === owner.userId && ref.deviceId === owner.deviceId
    ? 'local'
    : 'remote'
}

/**
 * The one name for an agent everywhere it is shown. A local agent is named for
 * its computer — "Local" on this one — and its provider is the subtitle.
 */
export function agentName(agent: NamedAgent, owner: ThisComputer): string {
  const tier = agentTier(agent, owner)

  if (tier === 'cloud') return agent.label
  if (tier === 'local') return 'Local'

  return agent.local?.deviceLabel ?? agent.label.replace(PROVIDER_SUFFIX, '')
}

const TIER_TITLE: Record<AgentTier, string> = {
  local: 'This computer',
  remote: 'My computers',
  cloud: 'Cloud',
}

export type AgentTierGroup<T> = { tier: AgentTier; title: string; agents: T[] }

/** Picker sections in display order; empty sections are left out. */
export function groupAgentsByTier<T extends NamedAgent>(
  agents: readonly T[],
  owner: ThisComputer,
): AgentTierGroup<T>[] {
  return (['local', 'remote', 'cloud'] as const).flatMap((tier) => {
    const members = agents.filter((agent) => agentTier(agent, owner) === tier)

    return members.length ? [{ tier, title: TIER_TITLE[tier], agents: members }] : []
  })
}

type SelectableAgent = NamedAgent & { status: 'active' | 'disabled' }

function usable(agent: SelectableAgent): boolean {
  return agent.status === 'active' && agent.local?.signedIn !== false
}

/** With no saved choice, a new conversation starts on this computer when it can. */
export function defaultAgent<T extends SelectableAgent>(
  agents: readonly T[],
  owner: ThisComputer,
): T | undefined {
  return (
    agents.find((agent) => agentTier(agent, owner) === 'local' && usable(agent)) ??
    agents.find((agent) => agentTier(agent, owner) === 'cloud' && usable(agent))
  )
}
