import { t } from '../i18n/index.ts'

import type { LocalRuntimeSummary } from '../types/runtime.ts'

export type ThisComputer = { userId: string; deviceId: string } | null

/** Local: this computer. Remote: the owner's other computers. Cloud: the team's agents. */
export type AgentTier = 'local' | 'remote' | 'cloud'

type NamedAgent = { id?: string; label: string; local?: LocalRuntimeSummary }

const LOCAL_ID = /^local_([A-Za-z0-9-]+)_([A-Za-z0-9-]+)(?:_(?:codex|grok|opencode|dsh))?$/u

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

type SelectableAgent = NamedAgent & {
  status: 'active' | 'disabled'
  notReady?: boolean
  provider?: string
}

/** Why an agent cannot take a turn now: listed greyed out with this, never chosen. */
export function unavailable(agent: NamedAgent): string | null {
  if (agent.local?.online === false) return t('Offline')
  if (agent.local?.signedIn === false) return t('Signed out')

  return null
}

function listable(agent: SelectableAgent): boolean {
  return agent.status === 'active' && !agent.notReady
}

/** The one rule for an agent a conversation can run on: listed, and not unavailable. */
export function usable(agent: SelectableAgent): boolean {
  return listable(agent) && !unavailable(agent)
}

/** The picker lists these; the unavailable ones it shows but does not offer. */
export function listedAgents<T extends SelectableAgent>(agents: readonly T[]): T[] {
  return agents.filter(listable)
}

// This computer's Claude Code, then its other agents, then any other: the one
// the person most likely just set up comes first.
function nearness(agent: SelectableAgent, owner: ThisComputer): number {
  if (agentTier(agent, owner) !== 'local') return 2

  return agent.provider === 'claude-code' ? 0 : 1
}

/**
 * A new conversation starts on the nearest usable agent; among equally near
 * ones, the one with the most quota left, unknown counting as full.
 */
export function defaultAgent<T extends SelectableAgent & { id: string }>(
  agents: readonly T[],
  owner: ThisComputer,
  usedPercent: (agent: T) => number | undefined = () => {},
): T | undefined {
  let best: T | undefined
  let bestRank: [number, number] = [Infinity, Infinity]

  for (const agent of agents) {
    if (!usable(agent)) continue
    const rank: [number, number] = [nearness(agent, owner), usedPercent(agent) ?? 0]

    if (rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) {
      best = agent
      bestRank = rank
    }
  }

  return best
}

/** The agent a new chat starts on: the last one picked while it can still run, else the default. */
export function newChatAgent<T extends SelectableAgent & { id: string }>(
  agents: readonly T[],
  lastPickedId: string | undefined,
  owner: ThisComputer,
  usedPercent?: (agent: T) => number | undefined,
): T | undefined {
  const last = agents.find((agent) => agent.id === lastPickedId)

  return last && usable(last) ? last : defaultAgent(agents, owner, usedPercent)
}
