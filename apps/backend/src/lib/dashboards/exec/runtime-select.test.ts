import { describe, expect, test } from 'bun:test'

import { RuntimeCapabilityError } from '@/lib/claude-code-preview/team-openab-runtime'

import { PanelExecError } from './errors'
import {
  boxEndpoints,
  PANEL_JOB,
  NO_RUNTIME_MESSAGE,
  OUTDATED_RUNTIME_MESSAGE,
  PARTLY_UNREACHABLE_RUNTIME_MESSAGE,
  randomRuntimeOrder,
  selectPanelRuntime,
  UNREACHABLE_RUNTIME_MESSAGE,
} from './runtime-select'

import type { PanelRuntimeClient, PanelRuntimeDeps } from './runtime-select'
import type { LocalRuntimeInstance } from '@/lib/claude-code-preview/local-runtime-catalog'
import type { TeamRuntimeEndpoint } from '@/lib/claude-code-preview/team-openab-runtime'

const context = { teamId: 'team-1', panelId: 'panel-1', userId: 'user-1' }
const endpoint = (id: string): TeamRuntimeEndpoint => ({
  runtimeId: id,
  url: `wss://${id}.example/acp`,
  authKey: 'k'.repeat(32),
})
const client = (jobs: string[]): PanelRuntimeClient => ({
  supportsRuntimeJob: (job) => jobs.includes(job),
  runJob: () => Promise.resolve({}),
})
const inOrder = (candidates: readonly TeamRuntimeEndpoint[]) => [...candidates]

function deps(
  endpoints: TeamRuntimeEndpoint[],
  byId: Record<string, PanelRuntimeClient | Error>,
): PanelRuntimeDeps & { tried: string[]; listedFor: string[] } {
  const tried: string[] = []
  const listedFor: string[] = []

  return {
    tried,
    listedFor,
    listEndpoints: (teamId, userId) => {
      listedFor.push(`${teamId}/${userId}`)

      return Promise.resolve(endpoints)
    },
    acquire: (_teamId, target) => {
      tried.push(target.runtimeId ?? '')
      const outcome = byId[target.runtimeId ?? '']

      return outcome instanceof Error || !outcome
        ? Promise.reject(outcome ?? new Error('offline'))
        : Promise.resolve(outcome)
    },
  }
}

async function selectionError(promise: Promise<unknown>): Promise<PanelExecError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof PanelExecError) return err
    throw err
  }
  throw new Error('expected selection to fail')
}

describe('selectPanelRuntime', () => {
  test('fails visibly when the team has no usable runtime', async () => {
    const err = await selectionError(selectPanelRuntime(context, inOrder, deps([], {})))

    expect(err.kind).toBe('runtime_unavailable')
    expect(err.message).toBe(NO_RUNTIME_MESSAGE)
  })

  test('skips unreachable and outdated runtimes for one that runs the job', async () => {
    const d = deps([endpoint('a'), endpoint('b'), endpoint('c')], {
      a: new Error('connection refused'),
      b: client([]),
      c: client([PANEL_JOB]),
    })
    const picked = await selectPanelRuntime(context, inOrder, d)

    expect(picked.endpoint.runtimeId).toBe('c')
    expect(d.tried).toEqual(['a', 'b', 'c'])
    expect(d.listedFor).toEqual(['team-1/user-1'])
  })

  test('reports an outdated image when every reachable runtime lacks the job', async () => {
    const err = await selectionError(
      selectPanelRuntime(
        context,
        inOrder,
        deps([endpoint('a'), endpoint('b')], {
          a: client(['other-job']),
          b: new RuntimeCapabilityError('no permission relay'),
        }),
      ),
    )

    expect(err.kind).toBe('runtime_outdated')
    expect(err.message).toBe(OUTDATED_RUNTIME_MESSAGE)
  })

  test('reports every runtime unreachable as unavailable', async () => {
    const err = await selectionError(
      selectPanelRuntime(
        context,
        inOrder,
        deps([endpoint('a'), endpoint('b')], {
          a: new Error('timeout'),
          b: new Error('Failed to connect to OpenAB ACP endpoint'),
        }),
      ),
    )

    expect(err.kind).toBe('runtime_unavailable')
    expect(err.message).toBe(UNREACHABLE_RUNTIME_MESSAGE)
  })

  test('reports unavailable, not outdated, when any runtime was unreachable', async () => {
    const err = await selectionError(
      selectPanelRuntime(
        context,
        inOrder,
        deps([endpoint('a'), endpoint('b'), endpoint('c')], {
          a: new Error('Expected 101 status code'),
          b: client(['other-job']),
          c: new RuntimeCapabilityError('no permission relay'),
        }),
      ),
    )

    expect(err.kind).toBe('runtime_unavailable')
    expect(err.message).toBe(PARTLY_UNREACHABLE_RUNTIME_MESSAGE)
  })

  test('follows the strategy order', async () => {
    const d = deps([endpoint('a'), endpoint('b')], {
      a: client([PANEL_JOB]),
      b: client([PANEL_JOB]),
    })
    const picked = await selectPanelRuntime(context, (candidates) => [...candidates].reverse(), d)

    expect(picked.endpoint.runtimeId).toBe('b')
  })
})

const agent = (id: string, local: Partial<LocalRuntimeInstance['local']>) =>
  ({ id, local: { online: true, box: { provider: 'instabox' }, ...local } }) as LocalRuntimeInstance

describe('boxEndpoints', () => {
  test("offers the online agents of the principal's own Boxes", async () => {
    const resolved: string[] = []
    const endpoints = await boxEndpoints(
      'team-1',
      'user-1',
      () =>
        Promise.resolve([
          agent('box', {}),
          agent('offline', { online: false }),
          agent('laptop', { box: undefined }),
          agent('shared', { shared: { level: 'full' } }),
          agent('signed-out', {}),
        ]),
      (teamId, runtimeId, userId, purpose) => {
        resolved.push(`${teamId}/${runtimeId}/${userId}/${purpose}`)

        return runtimeId === 'signed-out'
          ? Promise.reject(new Error('runtime_login_required'))
          : Promise.resolve({ ...endpoint(runtimeId), runtimeId })
      },
    )

    expect(endpoints.map((e) => e.runtimeId)).toEqual(['box'])
    expect(resolved).toEqual(['team-1/box/user-1/control', 'team-1/signed-out/user-1/control'])
  })
})

describe('randomRuntimeOrder', () => {
  test('returns a permutation of the candidates', () => {
    const candidates = ['a', 'b', 'c', 'd'].map(endpoint)
    const order = randomRuntimeOrder(candidates, context)

    expect(order.map((e) => e.runtimeId ?? '').sort((x, y) => x.localeCompare(y))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(candidates.map((e) => e.runtimeId)).toEqual(['a', 'b', 'c', 'd'])
  })
})
