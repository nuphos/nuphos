import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'
import { useObservability } from '@/lib/test/doubles/observability'

import type { AgentDevice } from './store'

// instabox reports every machine running; nothing here talks to a network.
// The machine `evicted` was last paused by instabox for its host's memory, the others by a client.
useInstaboxMachines({
  machineState: () => Promise.resolve('running'),
  lastPausedBy: (_conn, sandboxId) =>
    Promise.resolve(sandboxId === 'evicted' ? 'memory_pressure' : undefined),
})

const logged: unknown[] = []

useObservability({
  logEvent: (...entry) => {
    logged.push(entry)
  },
})

const { boxPausedBy, boxState, noteBoxEviction } = await import('./box-instabox-state')
const { config } = await import('@/config')
const saved = config.box.instabox

beforeAll(() => {
  config.box.instabox = { apiKey: 'test-key' } as typeof config.box.instabox
})
afterAll(() => {
  config.box.instabox = saved
})

const box = (sandboxId: string, lastSeenAt?: Date): AgentDevice =>
  ({
    userId: 'u',
    deviceId: sandboxId,
    label: 'Box 1',
    platform: 'linux',
    // Its host has claimed the Box's credential; connecting is what comes next.
    credentialHash: 'claimed',
    box: { provider: 'instabox', sandboxId },
    ...(lastSeenAt ? { lastSeenAt } : {}),
  }) as AgentDevice

describe('a running Box whose host is away', () => {
  test('is connecting until its host has joined once', async () => {
    expect(await boxState(box('never'), false)).toBe('connecting')
  })

  test('is starting while instabox has not made the machine yet', async () => {
    expect(
      await boxState({ ...box('none'), box: { provider: 'instabox' } } as AgentDevice, false),
    ).toBe('creating')
  })

  test('reads offline once its host has connected and then dropped', async () => {
    expect(await boxState(box('joined', new Date()), false)).toBe('running')
  })

  test('is running while its host is connected', async () => {
    expect(await boxState(box('live'), true)).toBe('running')
  })
})

describe('a Box instabox paused on its own', () => {
  test('says why, while it stays paused', async () => {
    expect(await boxPausedBy(box('evicted', new Date()))).toBe('memory_pressure')
  })

  test('says nothing when a person paused it', async () => {
    expect(await boxPausedBy(box('paused-by-owner', new Date()))).toBeUndefined()
  })

  test('is logged as evicted when its tunnel closes', async () => {
    logged.length = 0
    await noteBoxEviction('u', 'evicted', () => Promise.resolve(box('evicted')))
    expect(logged).toEqual([
      [
        'warn',
        'agent.box.evicted',
        { trigger: 'memory_pressure', machine_id: 'evicted', user_id: 'u', device_id: 'evicted' },
      ],
    ])
  })

  test('a tunnel that closes for any other reason logs nothing', async () => {
    logged.length = 0
    await noteBoxEviction('u', 'x', () => Promise.resolve(box('paused-by-owner')))
    await noteBoxEviction('u', 'x', () => Promise.resolve(null))
    expect(logged).toEqual([])
  })
})
