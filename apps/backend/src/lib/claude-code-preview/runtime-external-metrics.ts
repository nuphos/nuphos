import { logEvent } from '@/lib/observability'

import { controlRegistry } from './agent-chat-registry'
import { recordRuntimeMetricSample } from './runtime-metrics-store'
import { runtimeProvider } from './runtime-provider'
import { resolveTeamRuntimeEndpoints, runtimes } from './runtime-registry'
import { teamRuntimeSessions } from './runtime-team-sessions'

import type { RuntimeMetricSampleDoc } from './runtime-metrics-store'
import type { OpenAbProvider } from './runtime-provider'
import type { OwnedSessionIds } from './runtime-team-sessions'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'

type ExternalRuntime = { teamId: string; runtimeId: string; endpoint: TeamRuntimeEndpoint }

type UsageFields = Pick<
  RuntimeMetricSampleDoc,
  'cpuMillicores' | 'memoryBytes' | 'sessions' | 'diskTotalBytes' | 'diskUsedBytes'
>

export type ExternalSamplerDeps = {
  list: (nowMs: number) => Promise<ExternalRuntime[]>
  readState: (teamId: string, endpoint: TeamRuntimeEndpoint) => Promise<Record<string, unknown>>
  owned: OwnedSessionIds
}

const QUIET_LOG_INTERVAL_MS = 3_600_000
const quietLoggedAt = new Map<string, number>()

/** Active registered runtimes with the operator endpoint their status is read through. */
async function listExternalRuntimeControls(nowMs: number): Promise<ExternalRuntime[]> {
  const docs = await runtimes()
    .find({ status: 'active', managedBy: { $exists: false } })
    .project<{ _id: string; teamId: string; provider?: OpenAbProvider }>({
      teamId: 1,
      provider: 1,
    })
    .toArray()
  const groups = new Map<string, { teamId: string; provider: OpenAbProvider; ids: string[] }>()

  for (const doc of docs) {
    const provider = runtimeProvider(doc.provider)
    const key = `${doc.teamId}\0${provider}`
    const group = groups.get(key) ?? { teamId: doc.teamId, provider, ids: [] }

    group.ids.push(doc._id)
    groups.set(key, group)
  }
  const resolved = await Promise.all(
    [...groups.values()].map(async ({ teamId, provider, ids }) => {
      const endpoints = await resolveTeamRuntimeEndpoints(
        teamId,
        undefined,
        provider,
        'control',
      ).catch((error: unknown) => {
        logQuietly(
          `resolve\0${teamId}\0${provider}`,
          'openab.metrics.external_resolve_failed',
          { team_id: teamId, provider },
          error,
          nowMs,
        )

        return []
      })

      return endpoints.flatMap(({ runtimeId, ...rest }) =>
        runtimeId && ids.includes(runtimeId)
          ? [{ teamId, runtimeId, endpoint: { ...rest, runtimeId } }]
          : [],
      )
    }),
  )

  return resolved.flat()
}

const readControlState: ExternalSamplerDeps['readState'] = async (teamId, endpoint) =>
  (await controlRegistry.acquire(teamId, endpoint)).getRuntimeExecutionState()

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Sessions count only `teamId`'s own; a runtime that predates `usage` leaves the resources unknown. */
export async function runtimeStateUsage(
  teamId: string,
  state: Record<string, unknown>,
  owned?: OwnedSessionIds,
): Promise<UsageFields> {
  const usage = (state.usage && typeof state.usage === 'object' ? state.usage : {}) as Record<
    string,
    unknown
  >
  const sessions = Array.isArray(state.sessions)
    ? await teamRuntimeSessions(teamId, state.sessions as unknown[], owned)
    : null

  return {
    cpuMillicores: count(usage.cpuMillicores),
    memoryBytes: count(usage.memoryBytes),
    sessions: sessions?.length ?? null,
    diskTotalBytes: count(usage.diskTotalBytes),
    diskUsedBytes: count(usage.diskUsedBytes),
  }
}

function logQuietly(
  key: string,
  event: string,
  properties: Record<string, string>,
  error: unknown,
  nowMs: number,
): void {
  const last = quietLoggedAt.get(key)

  if (last !== undefined && nowMs - last < QUIET_LOG_INTERVAL_MS) return
  quietLoggedAt.set(key, nowMs)
  logEvent('info', event, {
    ...properties,
    error: error instanceof Error ? error.message : String(error),
  })
}

export async function sampleExternalRuntimeMetrics(
  at: Date,
  nowMs: number,
  {
    list = listExternalRuntimeControls,
    readState = readControlState,
    owned,
  }: Partial<ExternalSamplerDeps> = {},
): Promise<void> {
  const external = await list(nowMs)

  await Promise.all(
    external.map(async (runtime) => {
      let state: Record<string, unknown>

      try {
        state = await readState(runtime.teamId, runtime.endpoint)
      } catch (error) {
        logQuietly(
          `read\0${runtime.runtimeId}`,
          'openab.metrics.external_unreachable',
          { team_id: runtime.teamId, runtime_id: runtime.runtimeId },
          error,
          nowMs,
        )

        return
      }
      await recordRuntimeMetricSample({
        teamId: runtime.teamId,
        runtimeId: runtime.runtimeId,
        at,
        ...(await runtimeStateUsage(runtime.teamId, state, owned)),
      })
    }),
  )
}
