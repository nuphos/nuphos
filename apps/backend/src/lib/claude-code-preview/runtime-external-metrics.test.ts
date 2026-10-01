import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import type { TeamRuntimeEndpoint } from './team-openab-runtime'

type Written = { _id: string; sample: Record<string, unknown> }

let written: Written[] = []
let logged: string[] = []
let rows: { _id: string; teamId: string; provider?: string }[] = []
let resolveCalls: unknown[][] = []
let resolveFails = false

useDb({
  db: () => ({
    collection: () => ({
      updateOne: (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
        written.push({ _id: filter._id, sample: update.$set })

        return Promise.resolve({})
      },
    }),
  }),
})
useObservability({
  logEvent: (_level, event) => {
    logged.push(event)
  },
})
useRuntimeRegistry({
  runtimes: () => ({
    find: () => ({ project: () => ({ toArray: () => Promise.resolve(rows) }) }),
  }),
  resolveTeamRuntimeEndpoints: (...args: unknown[]) => {
    resolveCalls.push(args)
    if (resolveFails) return Promise.reject(new Error('registry unavailable'))
    const [teamId, , provider] = args as [string, unknown, string]

    return Promise.resolve(
      rows
        .filter((row) => row.teamId === teamId && (row.provider ?? 'claude-code') === provider)
        .map((row) => ({ url: `wss://${row._id}.example/acp`, authKey: 'k', runtimeId: row._id }))
        .concat([{ url: 'wss://managed.example/acp', authKey: 'k', runtimeId: 'binding-1' }]),
    )
  },
})

const { runtimeStateUsage, sampleExternalRuntimeMetrics } =
  await import('./runtime-external-metrics')

const at = new Date('2026-09-25T00:00:30.000Z')
const byText = (a: string, b: string) => a.localeCompare(b)
const downRuntime: TeamRuntimeEndpoint = {
  url: 'wss://ext-down.example/acp',
  authKey: 'k',
  runtimeId: 'ext-down',
}
const listDown = () =>
  Promise.resolve([{ teamId: 'team-1', runtimeId: 'ext-down', endpoint: downRuntime }])
const readEmpty = () => Promise.resolve({ sessions: [] })
const timeOut = () => Promise.reject(new Error('OpenAB ACP connection timed out'))

beforeEach(() => {
  written = []
  logged = []
  rows = []
  resolveCalls = []
  resolveFails = false
})

const ownsA = (_teamId: string, ids: string[]) =>
  Promise.resolve(new Set(ids.filter((id) => id.startsWith('sess_a'))))

test('a runtime that reports usage fills every series', async () => {
  expect(
    await runtimeStateUsage(
      'team-1',
      {
        sessions: [
          { sessionId: 'sess_a1', state: 'active' },
          { sessionId: 'sess_a2', state: 'idle' },
        ],
        usage: {
          cpuMillicores: 250,
          memoryBytes: 1024,
          diskUsedBytes: 10,
          diskTotalBytes: 100,
        },
      },
      ownsA,
    ),
  ).toEqual({
    cpuMillicores: 250,
    memoryBytes: 1024,
    sessions: 2,
    diskUsedBytes: 10,
    diskTotalBytes: 100,
  })
})

test('an older runtime without usage leaves resources unknown but still counts sessions', async () => {
  expect(await runtimeStateUsage('team-1', { sessions: [], authenticated: true })).toEqual({
    cpuMillicores: null,
    memoryBytes: null,
    sessions: 0,
    diskUsedBytes: null,
    diskTotalBytes: null,
  })
  expect(
    await runtimeStateUsage('team-1', {
      usage: { cpuMillicores: null, memoryBytes: 'x', diskUsedBytes: -1 },
    }),
  ).toMatchObject({ cpuMillicores: null, memoryBytes: null, sessions: null, diskUsedBytes: null })
})

test("counts only the sampled team's sessions on a runtime shared with other teams", async () => {
  const sessions = [
    { sessionId: 'sess_a1', state: 'active' },
    { sessionId: 'sess_b1', state: 'active' },
    { sessionId: 'sess_b2', state: 'idle' },
  ]

  expect(await runtimeStateUsage('team-1', { sessions }, ownsA)).toMatchObject({ sessions: 1 })
  expect(
    await runtimeStateUsage('team-1', { sessions: [{ state: 'active' }] }, ownsA),
  ).toMatchObject({ sessions: null })

  await sampleExternalRuntimeMetrics(at, at.getTime(), {
    list: () => Promise.resolve([{ teamId: 'team-1', runtimeId: 'shared', endpoint: downRuntime }]),
    readState: () => Promise.resolve({ sessions }),
    owned: ownsA,
  })
  expect(written[0]?.sample).toMatchObject({ teamId: 'team-1', sessions: 1 })
})

test('reads each self-hosted runtime through its operator endpoint, grouped per team and provider', async () => {
  rows = [
    { _id: 'ext-a', teamId: 'team-1' },
    { _id: 'ext-b', teamId: 'team-1' },
    { _id: 'ext-c', teamId: 'team-1', provider: 'codex' },
  ]
  const reads: string[] = []

  await sampleExternalRuntimeMetrics(at, at.getTime(), {
    readState: (teamId, target) => {
      reads.push(`${teamId}:${target.runtimeId ?? ''}`)

      return Promise.resolve({ sessions: [], usage: { cpuMillicores: 5 } })
    },
  })

  expect(resolveCalls.map((call) => [call[0], call[2], call[3]])).toEqual([
    ['team-1', 'claude-code', 'control'],
    ['team-1', 'codex', 'control'],
  ])
  expect(reads.toSorted(byText)).toEqual(['team-1:ext-a', 'team-1:ext-b', 'team-1:ext-c'])
  expect(written.map((row) => row._id).toSorted(byText)).toEqual([
    `ext-a:${String(at.getTime())}`,
    `ext-b:${String(at.getTime())}`,
    `ext-c:${String(at.getTime())}`,
  ])
  expect(written[0]?.sample).toMatchObject({ teamId: 'team-1', at, cpuMillicores: 5, sessions: 0 })
})

test('an unreachable runtime writes nothing and is logged at most once an hour', async () => {
  const deps = { list: listDown, readState: timeOut }
  const start = at.getTime()

  await sampleExternalRuntimeMetrics(at, start, deps)
  await sampleExternalRuntimeMetrics(at, start + 30_000, deps)
  await sampleExternalRuntimeMetrics(at, start + 59 * 60_000, deps)
  expect(written).toEqual([])
  expect(logged).toEqual(['openab.metrics.external_unreachable'])

  await sampleExternalRuntimeMetrics(at, start + 61 * 60_000, deps)
  expect(logged).toHaveLength(2)
})

test('a team whose endpoints cannot be resolved is skipped and logged at most once an hour', async () => {
  rows = [{ _id: 'ext-a', teamId: 'team-2' }]
  resolveFails = true
  const start = at.getTime() + 5 * 3_600_000

  await sampleExternalRuntimeMetrics(at, start, { readState: readEmpty })
  await sampleExternalRuntimeMetrics(at, start + 30_000, { readState: readEmpty })
  expect(written).toEqual([])
  expect(logged).toEqual(['openab.metrics.external_resolve_failed'])
})
