import { expect, test } from 'bun:test'

import { createLocalTunnelBus } from './bus'
import { attachRuntimeTunnel } from './holder'
import {
  commitLocalAgentInstance,
  createLocalAgentInstance,
  removeLocalAgentInstance,
} from './instances'
import { createMemoryPresenceStore } from './presence'
import { holderChannel, streamChannel } from './protocol'
import { DeviceRuntimeSocket } from './socket'

import type { HolderMessage } from './protocol'
import type { DeviceRuntimeSocketDeps } from './socket'

const instance = {
  instanceId: '11111111-1111-4111-8111-111111111111',
  provider: 'claude-code' as const,
  label: 'Work',
}
const target = { userId: 'owner', actorId: 'owner', deviceId: 'box', teamId: 'team' }

function setup(capable = true) {
  const bus = createLocalTunnelBus()
  const presence = {
    get: async () => ({
      conn: 'c1',
      seenAt: Date.now(),
      status: { agents: {}, agentInstances: capable },
    }),
  }

  return { bus, deps: { bus, presence } as unknown as DeviceRuntimeSocketDeps }
}

test('create RPC confirms the exact instance over the existing device tunnel', async () => {
  const { bus, deps } = setup()
  let stream = ''

  await bus.subscribe(holderChannel('owner', 'box'), (raw) => {
    const frame = JSON.parse(raw) as HolderMessage

    if (frame.t === 'open') {
      expect(frame.purpose).toBe('instances')
      stream = frame.s
      void bus.publish(streamChannel(stream), JSON.stringify({ t: 'opened' }))
    } else if (frame.t === 'data') {
      const request = JSON.parse(frame.d)

      expect(request.method).toBe('create')
      expect(request).toEqual({ method: 'create', ...instance })
      void bus.publish(
        streamChannel(stream),
        JSON.stringify({ t: 'data', d: JSON.stringify({ ok: true, instance }) }),
      )
    }
  })
  expect(await createLocalAgentInstance(target, instance, { deps })).toEqual(instance)
})

test('legacy hosts refuse create without opening a provider default', async () => {
  const { bus, deps } = setup(false)
  let opens = 0

  await bus.subscribe(holderChannel('owner', 'box'), (raw) => {
    if (JSON.parse(raw).t === 'open') opens++
  })
  await expect(createLocalAgentInstance(target, instance, { deps })).rejects.toMatchObject({
    code: 'runtime_offline',
  })
  expect(opens).toBe(0)
})

test('unanswered creates time out and close their stream', async () => {
  const { deps } = setup()

  await expect(
    createLocalAgentInstance(target, instance, { deps, timeoutMs: 5 }),
  ).rejects.toMatchObject({ code: 'agent_instance_timeout' })
})

test('the holder forwards the selected instance id and never opens an unknown one', async () => {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const opened: unknown[] = []
  const tunnel = await attachRuntimeTunnel(
    'owner',
    'box',
    {
      send(frame) {
        if (frame.t === 'open') opened.push(frame)
      },
      close() {},
    },
    { bus, presence, isMember: async () => true, heartbeatMs: 60_000 },
  )

  tunnel.receive(
    JSON.stringify({
      t: 'status',
      status: {
        agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } },
        instances: [{ ...instance, cli: { installed: true, loggedIn: false } }],
      },
    }),
  )
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await new Promise((resolve) => setTimeout(resolve, 5))
  const exact = new DeviceRuntimeSocket(
    { ...target, purpose: 'control', provider: instance.provider, instanceId: instance.instanceId },
    { bus, presence },
  )
  const missing = new DeviceRuntimeSocket(
    {
      ...target,
      purpose: 'control',
      provider: instance.provider,
      instanceId: '22222222-2222-4222-8222-222222222222',
    },
    { bus, presence },
  )

  try {
    await exact.connect()
    await missing.connect()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({
      t: 'open',
      instanceId: instance.instanceId,
      provider: instance.provider,
      purpose: 'control',
    })
    expect(missing.readyState).toBe(3)
  } finally {
    exact.close()
    missing.close()
    tunnel.closed()
  }
})

/** A host that answers every request with `reply`, recording what it was asked. */
async function answering(reply: (request: Record<string, unknown>) => object) {
  const { bus, deps } = setup()
  const requests: Record<string, unknown>[] = []
  let stream = ''

  await bus.subscribe(holderChannel('owner', 'box'), (raw) => {
    const frame = JSON.parse(raw) as HolderMessage

    if (frame.t === 'open') {
      stream = frame.s
      void bus.publish(streamChannel(stream), JSON.stringify({ t: 'opened' }))
    } else if (frame.t === 'data') {
      const request = JSON.parse(frame.d) as Record<string, unknown>

      requests.push(request)
      void bus.publish(
        streamChannel(stream),
        JSON.stringify({ t: 'data', d: JSON.stringify(reply(request)) }),
      )
    }
  })

  return { deps, requests }
}

test('create returns the pending agent the host recorded', async () => {
  const { deps } = await answering(() => ({
    ok: true,
    instance: { ...instance, state: 'pending' },
  }))

  expect(await createLocalAgentInstance(target, instance, { deps })).toEqual({
    ...instance,
    state: 'pending',
  })
})

test('commit and remove name only the instance, and surface the host refusal', async () => {
  const { deps, requests } = await answering((request) =>
    request.method === 'commit'
      ? { ok: false, error: 'The agent is not signed in yet' }
      : { ok: true },
  )

  await removeLocalAgentInstance(target, instance.instanceId, { deps })
  await expect(
    commitLocalAgentInstance(target, instance.instanceId, { deps }),
  ).rejects.toMatchObject({
    code: 'agent_instance_failed',
    message: 'The agent is not signed in yet',
  })
  expect(requests).toEqual([
    { method: 'remove', instanceId: instance.instanceId },
    { method: 'commit', instanceId: instance.instanceId },
  ])
})

test('a reply about a different agent is rejected', async () => {
  const { deps } = await answering(() => ({
    ok: true,
    instance: { ...instance, instanceId: '22222222-2222-4222-8222-222222222222' },
  }))

  await expect(
    commitLocalAgentInstance(target, instance.instanceId, { deps }),
  ).rejects.toMatchObject({ code: 'agent_instance_invalid_response' })
})
