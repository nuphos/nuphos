import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'

import type { AgentDevice } from './store'

// instabox reports every machine running; nothing here talks to a network.
useInstaboxMachines({ machineState: () => Promise.resolve('running') })

const { boxState } = await import('./box-instabox-state')
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
  test('is still starting until its host has connected once', async () => {
    expect(await boxState(box('never'), false)).toBe('creating')
  })

  test('reads offline once its host has connected and then dropped', async () => {
    expect(await boxState(box('joined', new Date()), false)).toBe('running')
  })

  test('is running while its host is connected', async () => {
    expect(await boxState(box('live'), true)).toBe('running')
  })
})
