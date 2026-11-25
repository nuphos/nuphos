import { beforeEach, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'

let runtimeId: string | undefined
let device: Record<string, unknown> | null

useAgentDb({
  getConversationBySessionId: async (sessionId) =>
    sessionId === 'gone' ? null : { sessionId, userId: 'owner', teamId: 't1', runtimeId },
})
useAgentDeviceStore({ getAgentDevice: async () => device })

const { computerDesktop, NO_DESKTOP, SHARED_DESKTOP } = await import('./computer-desktop')

const box = localRuntimeId({ userId: 'owner', deviceId: 'dev-1', provider: 'claude-code' })

const grant = (more: object) => ({
  teamId: 't1',
  everyone: false,
  userIds: [],
  managerIds: [],
  ...more,
})

beforeEach(() => {
  runtimeId = box
  device = { userId: 'owner', deviceId: 'dev-1', label: 'Box 1', access: [grant({})] }
})

test("a computer card names the conversation's own display on its Box", async () => {
  const opened: unknown[] = []
  const desktop = await computerDesktop('t1', 'conv-1', async (...args) => {
    opened.push(args)

    return { display: 12 }
  })

  expect(desktop).toEqual({ deviceId: 'dev-1', display: 12, title: 'Box 1' })
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
  runtimeId = box
  device = null
  expect(await computerDesktop('t1', 'conv-1', async () => ({ display: 1 }))).toBe(NO_DESKTOP)
})

test('a computer someone else owns, uses or manages hands its desktop to no one', async () => {
  const opened: unknown[] = []
  const open = async (...args: unknown[]) => {
    opened.push(args)

    return { display: 12 }
  }

  for (const shared of [
    { box: { createdBy: 'other' } },
    { access: [grant({ everyone: true })] },
    { access: [grant({}), grant({ teamId: 't2', userIds: ['other'] })] },
    { access: [grant({ managerIds: ['other'] })] },
  ]) {
    device = { userId: 'owner', deviceId: 'dev-1', label: 'Box 1', ...shared }
    expect(await computerDesktop('t1', 'conv-1', open)).toBe(SHARED_DESKTOP)
  }
  expect(opened).toEqual([])
  device = {
    userId: 'owner',
    deviceId: 'dev-1',
    label: 'Box 1',
    access: [grant({ userIds: ['owner'] })],
  }
  expect(await computerDesktop('t1', 'conv-1', open)).toEqual({
    deviceId: 'dev-1',
    display: 12,
    title: 'Box 1',
  })
})
