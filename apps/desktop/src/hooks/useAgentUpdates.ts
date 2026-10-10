import { useEffect, useState, useSyncExternalStore } from 'react'

import { api } from '../api.ts'
import { toast } from '../components/ui/toast.ts'
import { agentTier } from '../lib/agentName.ts'
import { localUpdateVersion } from '../lib/agentUpdate.ts'

import { useLocalRuntimeState } from './useLocalRuntimeState.ts'
import { useThisComputer } from './useThisComputer.ts'

import type { AgentCliStatus, LocalAgentProvider } from '../api'
import type { RuntimeInstance } from '../types/runtime'
import type { RuntimeUpdateStatus } from '../types/team'

export type AgentUpdate = {
  /** `updating`: this computer's CLI is mid-update, or a team agent's update is queued or rolling out. */
  state: 'available' | 'updating'
  version?: string
  /** Starts the update; absent when it cannot be started from here. */
  start?: () => void
  /** Why it cannot be started from here. */
  reason?: string
}

type LatestVersions = Partial<Record<LocalAgentProvider, string>>
type RemoteStatus = Pick<RuntimeUpdateStatus, 'state' | 'latestVersion' | 'targetVersion'>

const STATUS_TTL_MS = 10 * 60_000
/** A queued or rolling update is checked more often, so it clears soon after it lands. */
const PENDING_TTL_MS = 30_000
const CLI = {
  'claude-code': { name: 'Claude Code', command: 'claude' },
  codex: { name: 'Codex', command: 'codex' },
} as const

/** Shared by every selector, so open tabs ask each runtime once per hold. */
const remote = new Map<string, { at: number; ttl: number; status: Promise<RemoteStatus | null> }>()
/** Updates in flight from this window: `local:<provider>` or a team agent's id. */
let starting: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function setStarting(key: string, on: boolean) {
  const next = new Set(starting)

  if (on) next.add(key)
  else next.delete(key)
  starting = next
  for (const listener of listeners) listener()
}

function useStarting(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    () => starting,
  )
}

function remoteStatus(teamId: string, runtimeId: string): Promise<RemoteStatus | null> {
  const key = `${teamId}:${runtimeId}`
  const cached = remote.get(key)

  if (cached && Date.now() - cached.at < cached.ttl) return cached.status
  const entry = {
    at: Date.now(),
    ttl: STATUS_TTL_MS,
    status: api.atlasGetRuntimeInstanceStatus(teamId, runtimeId).then(
      (status) => status.runtimeUpdate ?? null,
      () => null,
    ),
  }

  remote.set(key, entry)
  void entry.status.then((status) => {
    if (status?.state === 'waiting' || status?.state === 'updating') entry.ttl = PENDING_TTL_MS
  })

  return entry.status
}

async function updateLocal(provider: LocalAgentProvider, before?: string) {
  const key = `local:${provider}`
  const { name, command } = CLI[provider]

  if (starting.has(key)) return
  setStarting(key, true)
  try {
    const state = await api.localRuntimeUpdateAgent(provider)
    const cli = state.agents[provider].cli
    const version = cli?.installed ? cli.version : undefined

    if (version && version === before)
      toast.info(
        `${name} did not change`,
        'It may be installed by a package manager that updates it separately.',
      )
    else
      toast.success(
        version ? `${name} updated to v${version}` : `${name} updated`,
        'New conversations use it; running ones finish on the version they started with.',
      )
  } catch (err) {
    toast.apiError(`Could not update ${name}`, err, {
      fallback: `Run \`${command} update\` in a terminal to see why.`,
    })
  } finally {
    setStarting(key, false)
  }
}

async function updateTeamAgent(teamId: string, runtimeId: string) {
  if (starting.has(runtimeId)) return
  setStarting(runtimeId, true)
  try {
    const { version } = await api.atlasRequestRuntimeUpdate(teamId, runtimeId)

    remote.set(`${teamId}:${runtimeId}`, {
      at: Date.now(),
      ttl: PENDING_TTL_MS,
      status: Promise.resolve({ state: 'waiting', targetVersion: version }),
    })
    toast.success('Update queued', 'It starts once conversations on this agent finish.')
  } catch (err) {
    toast.apiError('Could not update this agent', err)
  } finally {
    setStarting(runtimeId, false)
  }
}

function useLocalAgentLatest(): LatestVersions {
  const [latest, setLatest] = useState<LatestVersions>({})

  useEffect(() => {
    let cancelled = false

    api.localRuntimeLatestAgentVersions().then(
      (versions) => !cancelled && setLatest(versions),
      () => {},
    )

    return () => {
      cancelled = true
    }
  }, [])

  return latest
}

/** This computer's CLI: the version it can update to, and the one update all views share. */
export function useLocalAgentUpdate(provider: LocalAgentProvider) {
  const local = useLocalRuntimeState()
  const latest = useLocalAgentLatest()
  const busy = useStarting()
  const cli = local?.agents[provider].cli

  return {
    version: localUpdateVersion(cli, latest[provider]),
    updating: busy.has(`local:${provider}`),
    start: () => void updateLocal(provider, cli?.installed ? cli.version : undefined),
  }
}

function localAgentUpdate(
  provider: LocalAgentProvider,
  cli: AgentCliStatus | null | undefined,
  latest: string | undefined,
  busy: ReadonlySet<string>,
): AgentUpdate | undefined {
  const version = localUpdateVersion(cli, latest)

  if (busy.has(`local:${provider}`)) return { state: 'updating', version }
  if (!version) return
  const before = cli?.installed ? cli.version : undefined

  return { state: 'available', version, start: () => void updateLocal(provider, before) }
}

/** `teamId` is set only for someone allowed to update the team's agents. */
function teamAgentUpdate(
  instance: RuntimeInstance,
  status: RemoteStatus | undefined,
  busy: ReadonlySet<string>,
  teamId: string | undefined,
): AgentUpdate | undefined {
  const { id, kind } = instance

  if (busy.has(id) || status?.state === 'waiting' || status?.state === 'updating')
    return { state: 'updating', version: status?.targetVersion }
  if (status?.state !== 'available' && status?.state !== 'failed') return
  const version = status.latestVersion

  if (kind !== 'managed')
    return { state: 'available', version, reason: 'Update this agent on the machine that runs it.' }
  if (!teamId)
    return {
      state: 'available',
      version,
      reason: 'Ask a workspace administrator to update this agent.',
    }

  return { state: 'available', version, start: () => void updateTeamAgent(teamId, id) }
}

/** The agents among `instances` that run an older release, and how to update each. */
export function useAgentUpdates(
  teamId: string | undefined,
  instances: readonly RuntimeInstance[],
  canUpdateTeamAgents = false,
): ReadonlyMap<string, AgentUpdate> {
  const owner = useThisComputer()
  const local = useLocalRuntimeState()
  const latest = useLocalAgentLatest()
  const busy = useStarting()
  const [statuses, setStatuses] = useState<ReadonlyMap<string, RemoteStatus>>(new Map())
  // Another computer's agent cannot be asked from here; team agents report their own.
  const remoteKey = instances
    .filter((i) => agentTier(i, owner) === 'cloud' && i.status === 'active' && !i.deletion)
    .map((i) => i.id)
    .join(',')

  useEffect(() => {
    if (!teamId || !remoteKey) return
    let cancelled = false
    const ids = remoteKey.split(',')
    const load = () => {
      void Promise.all(ids.map((id) => remoteStatus(teamId, id))).then((list) => {
        if (cancelled) return
        setStatuses(new Map(ids.flatMap((id, i) => (list[i] ? [[id, list[i]] as const] : []))))
      })
    }

    load()
    const timer = setInterval(load, PENDING_TTL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [teamId, remoteKey, busy])

  const updates = new Map<string, AgentUpdate>()

  for (const instance of instances) {
    const { id, provider } = instance
    const tier = agentTier(instance, owner)
    const update =
      tier === 'local' && (provider === 'claude-code' || provider === 'codex')
        ? localAgentUpdate(provider, local?.agents[provider].cli, latest[provider], busy)
        : tier === 'cloud' &&
          teamAgentUpdate(
            instance,
            statuses.get(id),
            busy,
            canUpdateTeamAgents ? teamId : undefined,
          )

    if (update) updates.set(id, update)
  }

  return updates
}
