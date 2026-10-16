import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'
import { afterEach, expect, test } from 'bun:test'

import { dispatchLocalExec } from './dispatch'
import { createLocalTunnelBus } from './local-runtime/bus'
import { attachRuntimeTunnel } from './local-runtime/holder'
import { createMemoryPresenceStore } from './local-runtime/presence'

import type { RuntimeTunnel } from './local-runtime/holder'

const target: AgentDevice = {
  userId: 'u1',
  deviceId: 'd1',
  label: 'Box',
  platform: 'linux',
  allowLocalExec: true,
  box: { provider: 'instabox', teamId: 't1', access: { everyone: false, userIds: ['viewer'] } },
  createdAt: new Date(),
  updatedAt: new Date(),
}
const access: DeviceAccessDeps = {
  getDevice: () => Promise.resolve(target),
  listDevices: () => Promise.resolve([target]),
  listBoxes: () => Promise.resolve([target, { ...target, deviceId: 'offline' }]),
  role: (actor, team) =>
    Promise.resolve(team === 't1' ? (actor === 'u1' ? 'ADMINISTRATOR' : 'EDITOR') : null),
}

const tunnels: RuntimeTunnel[] = []

afterEach(() => {
  for (const tunnel of tunnels.splice(0)) tunnel.closed()
})

async function setup(
  options: { reply?: boolean; exec?: boolean; member?: boolean; terminal?: boolean } = {},
) {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const commands: string[] = []
  const tunnel = await attachRuntimeTunnel(
    'u1',
    'd1',
    {
      send: (frame) => {
        if (frame.t === 'open') tunnel.receive(JSON.stringify({ t: 'opened', s: frame.s }))
        if (frame.t === 'data') {
          commands.push(frame.d)
          if (options.reply !== false)
            tunnel.receive(
              JSON.stringify({
                t: 'data',
                s: frame.s,
                d: JSON.stringify({ stdout: 'ok', stderr: '', exitCode: 0 }),
              }),
            )
        }
      },
      close: () => {},
    },
    { bus, presence, isMember: async () => options.member !== false, heartbeatMs: 60_000 },
  )

  tunnels.push(tunnel)
  tunnel.receive(
    JSON.stringify({
      t: 'status',
      status: {
        agents: {},
        localExec: options.exec !== false,
        localTerminal: options.terminal === true,
      },
    }),
  )
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await Promise.resolve()

  return { bus, presence, commands, tunnel }
}

test('dispatches and returns the result through the shared tunnel without any local agent', async () => {
  const deps = await setup()

  expect(await dispatchLocalExec('u1', 'd1', 'echo ok', { teamId: 't1', access, deps })).toEqual({
    status: 'ok',
    result: { stdout: 'ok', stderr: '', exitCode: 0 },
  })
  expect(deps.commands).toEqual(['echo ok'])
})

test('offline and old clients without exec capability fail immediately', async () => {
  const deps = await setup({ exec: false })

  for (const device of ['d1', 'offline']) {
    expect(
      await dispatchLocalExec('u1', device, 'echo ok', { teamId: 't1', access, deps }),
    ).toEqual({
      status: 'device_disconnected',
    })
  }
  expect(deps.commands).toEqual([])
})

test('the holder rechecks team membership before opening a command stream', async () => {
  const deps = await setup({ member: false })

  expect(await dispatchLocalExec('u1', 'd1', 'echo ok', { teamId: 't1', access, deps })).toEqual({
    status: 'device_disconnected',
  })
  expect(deps.commands).toEqual([])
})

test('disconnect closes an in-flight command without waiting forty seconds', async () => {
  const deps = await setup({ reply: false })
  const result = dispatchLocalExec('u1', 'd1', 'sleep 30', { teamId: 't1', access, deps })

  await new Promise((resolve) => setTimeout(resolve, 10))
  deps.tunnel.closed()
  expect(await result).toEqual({ status: 'device_disconnected' })
})

test('a deadline closes the command stream, with no automatic replay', async () => {
  const deps = await setup({ reply: false })

  expect(
    await dispatchLocalExec('u1', 'd1', 'sleep 30', { teamId: 't1', access, deps, timeoutMs: 20 }),
  ).toEqual({ status: 'timeout' })
  expect(deps.commands).toEqual(['sleep 30'])
})

test('terminal requests require their own capability and never reach old exec clients', async () => {
  const old = await setup()

  expect(
    await dispatchLocalExec('u1', 'd1', '{"action":"open"}', {
      teamId: 't1',
      access,
      deps: old,
      purpose: 'terminal',
    }),
  ).toEqual({ status: 'device_disconnected' })
  expect(old.commands).toEqual([])
  const current = await setup({ terminal: true })

  expect(
    (
      await dispatchLocalExec('u1', 'd1', '{"action":"open"}', {
        teamId: 't1',
        access,
        deps: current,
        purpose: 'terminal',
      })
    ).status,
  ).toBe('ok')
  expect(current.commands).toEqual(['{"action":"open"}'])
})

test('dispatch authorizes the actor and sends through the owner tunnel; revocation denies later terminal input', async () => {
  const deps = await setup({ terminal: true })
  const shared = { ...access, listBoxes: () => Promise.resolve([target]) }

  expect(
    (await dispatchLocalExec('viewer', 'd1', 'echo shared', { teamId: 't1', deps, access: shared }))
      .status,
  ).toBe('ok')
  expect(deps.commands).toEqual(['echo shared'])
  const revoked = {
    ...shared,
    listBoxes: () =>
      Promise.resolve([
        { ...target, box: { ...target.box!, access: { everyone: false, userIds: [] } } },
      ]),
  }

  await expect(
    dispatchLocalExec('viewer', 'd1', 'write', {
      teamId: 't1',
      purpose: 'terminal',
      deps,
      access: revoked,
    }),
  ).rejects.toMatchObject({ status: 404 })
  await expect(
    dispatchLocalExec('viewer', 'd1', 'echo cross', { teamId: 't2', deps, access: shared }),
  ).rejects.toMatchObject({ status: 404 })
  await expect(
    dispatchLocalExec('viewer', 'd1', 'echo removed', {
      teamId: 't1',
      deps,
      access: { ...shared, role: () => Promise.resolve(null) },
    }),
  ).rejects.toMatchObject({ status: 404 })
  expect(deps.commands).toEqual(['echo shared'])
})
