import { describe, expect, mock, test } from 'bun:test'

import type { AgentDevice } from './store'

class InstaboxError extends Error {
  constructor(readonly status: number) {
    super(`instabox ${status}`)
  }
}

void mock.module('@insforge/instabox-sdk', () => ({
  InstaboxError,
  Sandbox: { connect: async () => ({ getInfo: async () => ({ state: 'running' }) }) },
}))
void mock.module('./box-instabox-client', () => ({ connection: () => ({}) }))

const { boxState } = await import('./box-instabox-state')

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
