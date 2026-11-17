import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createBoxTerminalRoutes } from './routes-devices-box-terminal'

import type { AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

const TEAM = '69e989027ab63e8d6a0ffcb6'
const box = (extra: Partial<AgentDevice> = {}): AgentDevice => ({
  userId: 'host',
  deviceId: 'box',
  label: 'Box',
  platform: 'linux',
  allowLocalExec: true,
  box: { provider: 'instabox', teamId: TEAM, createdBy: 'owner' },
  access: [
    { teamId: TEAM, everyone: false, userIds: ['user', 'manager'], managerIds: ['manager'] },
  ],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...extra,
})

function app(userId: string, device: AgentDevice = box()) {
  const saved: { userId: string; deviceId: string; useTerminal: boolean }[] = []
  const server = new Hono<{ Variables: AuthVariables }>()

  server.use('*', async (c, next) => {
    c.set('userId', userId)
    await next()
  })
  server.onError((error, c) =>
    c.json(
      { error: 'code' in error ? error.code : error.message },
      'status' in error ? (error.status as 400) : 500,
    ),
  )
  server.route(
    '/',
    createBoxTerminalRoutes({
      access: {
        getDevice: async () => null,
        listDevices: async () => [],
        listBoxes: async (teamId) => (teamId === TEAM ? [device] : []),
        listGranted: async () => [],
        findGranted: async () => [],
        role: async () => 'EDITOR',
      },
      setUseTerminal: async (owner, deviceId, useTerminal) => {
        saved.push({ userId: owner, deviceId, useTerminal })

        return true
      },
    }),
  )
  const put = (body: unknown) =>
    server.request(`/devices/box/box/terminal-access?teamId=${TEAM}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  return { put, saved }
}

test('the owner lets those who use the Box open a terminal, and takes it back', async () => {
  const { put, saved } = app('owner')

  expect(await (await put({ useTerminal: true })).json()).toEqual({ useTerminal: true })
  expect(await (await put({ useTerminal: false })).json()).toEqual({ useTerminal: false })
  // Saved on the host's row, whoever owns the Box.
  expect(saved).toEqual([
    { userId: 'host', deviceId: 'box', useTerminal: true },
    { userId: 'host', deviceId: 'box', useTerminal: false },
  ])
})

test('only the owner decides: a manager or user cannot, nor anyone for a computer that is no Box', async () => {
  for (const actor of ['manager', 'user', 'stranger']) {
    const { put, saved } = app(actor)

    expect((await put({ useTerminal: true })).status).toBe(404)
    expect(saved).toEqual([])
  }
  expect((await app('owner').put({ useTerminal: 'yes' })).status).toBe(400)
})
