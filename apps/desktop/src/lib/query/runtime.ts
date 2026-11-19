import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

import type {
  RuntimeInstance,
  RuntimeQuota,
  RuntimeQuotaHistoryRange,
} from '../../types/runtime.ts'
import type { OpenAbRuntimeStatus } from '../../types/team.ts'
import type { QueryClient } from '@tanstack/react-query'

const INSTANCES_POLL_MS = 10_000
/** Matches the backend's shorter hold, not its longer one: an offline agent, a timeout or a
 *  sign-in prompt is held thirty seconds there. A provider's own answer is held ten minutes, so
 *  this never reaches Anthropic or ChatGPT more often than that. */
const QUOTAS_POLL_MS = 30_000
const STATUS_POLL_MS = 10_000
/** An agent that is starting is watched closely, so Sign in appears the moment it can. */
const STARTING_POLL_MS = 2_000

const METRICS_POLL_MS = 30_000
/** A reading is held ten minutes on the backend, so nothing new arrives sooner. */
const QUOTA_HISTORY_POLL_MS = 600_000

export type PolledRuntimeStatus = OpenAbRuntimeStatus & { fetchedAtMs: number }

const presence = (instances: readonly RuntimeInstance[]) =>
  JSON.stringify(instances.map(({ id, local }) => [id, local?.usageAt]))

/** The team's agents. An agent or its first usage reading can arrive after usage was
 *  read, so a change in which agents report usage reads usage again. */
export const runtimeInstancesQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.runtimeInstances(teamId),
    queryFn: async ({ client, queryKey }) => {
      const instances = await api.atlasListRuntimeInstances(teamId)
      const before = client.getQueryData<RuntimeInstance[]>(queryKey)

      if (before && presence(before) !== presence(instances))
        void client.invalidateQueries({ queryKey: queryKeys.runtimeQuotas(teamId) })

      return instances
    },
    staleTime: INSTANCES_POLL_MS,
  })

export const useRuntimeInstancesQuery = (teamId?: string) =>
  useQuery({
    ...runtimeInstancesQuery(teamId ?? ''),
    enabled: Boolean(teamId),
    refetchInterval: INSTANCES_POLL_MS,
  })

const byRuntime = (quotas: RuntimeQuota[]): ReadonlyMap<string, RuntimeQuota> =>
  new Map(quotas.map((quota) => [quota.runtimeId, quota]))

/** Each agent's usage, by runtime id. */
export const runtimeQuotasQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.runtimeQuotas(teamId),
    queryFn: () => api.atlasListRuntimeQuotas(teamId),
    select: byRuntime,
    staleTime: QUOTAS_POLL_MS,
  })

export const useRuntimeQuotasQuery = (teamId?: string) =>
  useQuery({
    ...runtimeQuotasQuery(teamId ?? ''),
    enabled: Boolean(teamId),
    refetchInterval: QUOTAS_POLL_MS,
  })

/** One agent's live status, read again on mount and watched closely while it starts. */
export const useRuntimeStatusQuery = (teamId: string, runtimeId: string) =>
  useQuery({
    queryKey: queryKeys.runtimeStatus(teamId, runtimeId),
    queryFn: async (): Promise<PolledRuntimeStatus> => ({
      ...(await api.atlasGetRuntimeInstanceStatus(teamId, runtimeId)),
      fetchedAtMs: Date.now(),
    }),
    staleTime: 0,
    refetchInterval: ({ state }) =>
      state.status === 'success' && !state.data?.online ? STARTING_POLL_MS : STATUS_POLL_MS,
  })

/** A hosted runtime's resource samples over the last `hours`; the last window stays on screen
 *  while another loads. */
export const useRuntimeMetricsQuery = (teamId: string, runtimeId: string, hours: number) =>
  useQuery({
    queryKey: queryKeys.runtimeMetrics(teamId, runtimeId, hours),
    queryFn: async () =>
      (await api.atlasGetRuntimeInstanceMetrics(teamId, runtimeId, hours)).samples,
    placeholderData: keepPreviousData,
    refetchInterval: METRICS_POLL_MS,
  })

/** The team's subscription usage over `range`. The answer names its range, because the last
 *  range stays on screen while another loads. */
export const useRuntimeQuotaHistoryQuery = (teamId: string, range: RuntimeQuotaHistoryRange) =>
  useQuery({
    queryKey: queryKeys.runtimeQuotaHistory(teamId, range),
    queryFn: async () => ({
      range,
      series: await api.atlasGetRuntimeQuotaHistory(teamId, range),
      nowMs: Date.now(),
    }),
    staleTime: QUOTA_HISTORY_POLL_MS,
    placeholderData: keepPreviousData,
    refetchInterval: QUOTA_HISTORY_POLL_MS,
  })

/** Each runtime's fallback in the team, by runtime id. */
export const runtimeFallbackQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.runtimeFallback(teamId),
    queryFn: async () => (await api.atlasGetRuntimeFallback(teamId)).fallbacks,
  })

/** Every team's agents and usage that a view shows are read again, each once. */
export function refreshRuntimeLists(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: ({ queryKey: [scope, , kind] }) =>
      scope === 'team' && (kind === 'runtime-instances' || kind === 'runtime-quotas'),
  })
}
