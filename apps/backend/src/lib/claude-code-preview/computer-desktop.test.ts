import { beforeEach, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'

let runtimeId: string | undefined

useAgentDb({
  getConversationBySessionId: async (sessionId) =>
    sessionId === 'gone' ? null : { sessionId, userId: 'owner', teamId: 't1', runtimeId },
})
useAgentDeviceStore({ getAgentDevice: async () => ({ label: 'Box 1' }) })

const { computerDesktop, NO_DESKTOP } = await import('./computer-desktop')

const box = localRuntimeId({ userId: 'owner', deviceId: 'dev-1', provider: 'claude-code' })

beforeEach(() => {
  runtimeId = box
})

test("a computer card names the conversation's own display on its Box", async () => {
  const opened: unknown[] = []
  const desktop = await computerDesktop('t1', 'conv-1', async (...args) => {
    opened.push(args)

    return { display: 12 }
  })

  expect(desktop).toEqual({ deviceId: 'dev-1', display: 12, title: 'Box 1 · :12' })
  expect(opened).toEqual([['t1', 'owner', 'conv-1']])
})

test('a conversation with no desktop to hand over is told so', async () => {
  const none = async () => {
    throw new Error('no desktop pool')
  }

  expect(await computerDesktop('t1', 'conv-1', none)).toBe(NO_DESKTOP)
  runtimeId = undefined
  expect(await computerDesktop('t1', 'conv-1', async () => ({ display: 1 }))).toBe(NO_DESKTOP)
  expect(await computerDesktop('t1', 'gone', async () => ({ display: 1 }))).toBe(NO_DESKTOP)
})
