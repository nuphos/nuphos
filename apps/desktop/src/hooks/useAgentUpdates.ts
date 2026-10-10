import { useEffect, useState } from 'react'

import { api } from '../api.ts'
import { agentTier } from '../lib/agentName.ts'
import { localUpdateVersion } from '../lib/agentUpdate.ts'

import { useLocalRuntimeState } from './useLocalRuntimeState.ts'
import { useThisComputer } from './useThisComputer.ts'

import type { LocalAgentProvider } from '../api'
import type { RuntimeInstance } from '../types/runtime'

type LatestVersions = Partial<Record<LocalAgentProvider, string>>

const STATUS_TTL_MS = 10 * 60_000
const EMPTY: ReadonlySet<string> = new Set()
/** Shared by every selector, so open tabs ask each runtime once per hold. */
const remote = new Map<string, { at: number; available: Promise<boolean> }>()

export function useLocalAgentLatest(): LatestVersions {
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

function remoteUpdate(teamId: string, runtimeId: string): Promise<boolean> {
  const key = `${teamId}:${runtimeId}`
  const cached = remote.get(key)

  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.available
  const available = api.atlasGetRuntimeInstanceStatus(teamId, runtimeId).then(
    (status) => status.runtimeUpdate?.state === 'available',
    () => false,
  )

  remote.set(key, { at: Date.now(), available })

  return available
}

/** The agents among `instances` with a newer release than the one they run. */
export function useAgentUpdates(
  teamId: string | undefined,
  instances: readonly RuntimeInstance[],
): ReadonlySet<string> {
  const owner = useThisComputer()
  const local = useLocalRuntimeState()
  const latest = useLocalAgentLatest()
  const [remoteIds, setRemoteIds] = useState(EMPTY)
  // Another computer's agent cannot be asked from here; team agents report their own.
  const remoteKey = instances
    .filter((i) => agentTier(i, owner) === 'cloud' && i.status === 'active' && !i.deletion)
    .map((i) => i.id)
    .join(',')

  useEffect(() => {
    if (!teamId || !remoteKey) return
    let cancelled = false
    const ids = remoteKey.split(',')

    void Promise.all(ids.map((id) => remoteUpdate(teamId, id))).then((flags) => {
      if (!cancelled) setRemoteIds(new Set(ids.filter((_, i) => flags[i])))
    })

    return () => {
      cancelled = true
    }
  }, [teamId, remoteKey])

  const ids = new Set<string>()

  for (const instance of instances) {
    const { provider } = instance
    const update =
      agentTier(instance, owner) === 'local'
        ? (provider === 'claude-code' || provider === 'codex') &&
          localUpdateVersion(local?.agents[provider].cli, latest[provider])
        : remoteIds.has(instance.id)

    if (update) ids.add(instance.id)
  }

  return ids
}
