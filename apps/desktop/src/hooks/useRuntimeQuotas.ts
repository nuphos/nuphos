import { useCallback, useSyncExternalStore } from 'react'

import { api } from '../api.ts'

import { pollSnapshot, subscribePoll } from './sharedPoll.ts'
import { runtimeQuotasKey } from './useRuntimeInstances.ts'

import type { RuntimeQuota } from '../types/runtime'

/** Matches the backend's shorter hold, not its longer one: an offline agent, a
 *  timeout or a sign-in prompt is held thirty seconds there, so an agent that
 *  comes back has to be visible in that order of time. A provider's own answer
 *  is held ten minutes, so this tick never reaches Anthropic or ChatGPT more
 *  often than that. Agents arriving or reporting new usage read it sooner; see
 *  useRuntimeInstances. */
const QUOTA_POLL_MS = 30_000
const EMPTY: ReadonlyMap<string, RuntimeQuota> = new Map()

export function useRuntimeQuotas(teamId?: string): ReadonlyMap<string, RuntimeQuota> {
  const key = teamId ? runtimeQuotasKey(teamId) : undefined
  const subscribe = useCallback(
    (listener: () => void) =>
      teamId && key
        ? subscribePoll(
            key,
            async () =>
              new Map(
                (await api.atlasListRuntimeQuotas(teamId)).map((quota) => [quota.runtimeId, quota]),
              ),
            QUOTA_POLL_MS,
            listener,
          )
        : () => {},
    [teamId, key],
  )

  // Quota is decoration: a failed read keeps whatever was shown before.
  return (
    useSyncExternalStore(subscribe, () => pollSnapshot<ReadonlyMap<string, RuntimeQuota>>(key))
      .value ?? EMPTY
  )
}
