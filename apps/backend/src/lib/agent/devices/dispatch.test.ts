import { afterEach, expect, test } from 'bun:test'

import { dispatchLocalExec } from './dispatch'
import { createLocalTunnelBus } from './local-runtime/bus'
import { attachRuntimeTunnel } from './local-runtime/holder'
import { createMemoryPresenceStore } from './local-runtime/presence'

import type { RuntimeTunnel } from './local-runtime/holder'

const tunnels: RuntimeTunnel[] = []

afterEach(() => {
  for (const tunnel of tunnels.splice(0)) tunnel.closed()
})

async function setup(options: { reply?: boolean; exec?: boolean; member?: boolean; terminal?: boolean } = {}) {
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
    JSON.stringify({ t: 'status', status: { agents: {}, localExec: options.exec !== false, localTerminal: options.terminal === true } }),
  )
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await Promise.resolve()

  return { bus, presence, commands, tunnel }
}

test('dispatches and returns the result through the shared tunnel without any local agent', async () => {
  const deps = await setup()

  expect(await dispatchLocalExec('u1', 'd1', 'echo ok', { teamId: 't1', deps })).toEqual({
    status: 'ok',
    result: { stdout: 'ok', stderr: '', exitCode: 0 },
  })
  expect(deps.commands).toEqual(['echo ok'])
})

test('offline and old clients without exec capability fail immediately', async () => {
  const deps = await setup({ exec: false })

  for (const device of ['d1', 'offline']) {
    expect(await dispatchLocalExec('u1', device, 'echo ok', { teamId: 't1', deps })).toEqual({
      status: 'device_disconnected',
    })
  }
  expect(deps.commands).toEqual([])
})

test('the holder rechecks team membership before opening a command stream', async () => {
  const deps = await setup({ member: false })

  expect(await dispatchLocalExec('u1', 'd1', 'echo ok', { teamId: 't1', deps })).toEqual({
    status: 'device_disconnected',
  })
  expect(deps.commands).toEqual([])
})

test('disconnect closes an in-flight command without waiting forty seconds', async () => {
  const deps = await setup({ reply: false })
  const result = dispatchLocalExec('u1', 'd1', 'sleep 30', { teamId: 't1', deps })

  await new Promise((resolve) => setTimeout(resolve, 10))
  deps.tunnel.closed()
  expect(await result).toEqual({ status: 'device_disconnected' })
})

test('a deadline closes the command stream, with no automatic replay', async () => {
  const deps = await setup({ reply: false })

  expect(
    await dispatchLocalExec('u1', 'd1', 'sleep 30', { teamId: 't1', deps, timeoutMs: 20 }),
  ).toEqual({ status: 'timeout' })
  expect(deps.commands).toEqual(['sleep 30'])
})


test('terminal requests require their own capability and never reach old exec clients', async () => {
  const old = await setup()

  expect(await dispatchLocalExec('u1', 'd1', '{"action":"open"}', { teamId: 't1', deps: old, purpose: 'terminal' })).toEqual({ status: 'device_disconnected' })
  expect(old.commands).toEqual([])
  const current = await setup({ terminal: true })

  expect((await dispatchLocalExec('u1', 'd1', '{"action":"open"}', { teamId: 't1', deps: current, purpose: 'terminal' })).status).toBe('ok')
  expect(current.commands).toEqual(['{"action":"open"}'])
})
