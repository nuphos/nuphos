import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: string[] = []
const bodies: unknown[] = []
const options: unknown[] = []
let samples = 0
const metrics = {
  sampledAt: '2026-10-15T00:00:00Z',
  cpuPercent: 10,
  memory: { used: 1, total: 2 },
  disk: { used: 3, total: 4 },
}
const remote = {
  deviceId: 'box',
  label: 'Box',
  platform: 'linux',
  metricsStatus: 'stale',
  metricsReceivedAt: '2026-10-14T23:00:00Z',
  metrics,
}
const list = {
  devices: [{ deviceId: 'mac', label: 'Mac', platform: 'darwin' }, remote],
  boxAvailable: true,
}

mock.module('./client.ts', {
  namedExports: {
    call: async (_method: string, path: string, body?: unknown, opts?: unknown) => {
      calls.push(path)
      bodies.push(body)
      options.push(opts)

      return list
    },
  },
})
mock.module('../main/device-identity.ts', {
  namedExports: { readDeviceIdentity: () => ({ deviceId: 'mac' }) },
})
mock.module('../main/device-metrics.ts', {
  namedExports: {
    readDeviceMetrics: async () => {
      samples += 1

      return metrics
    },
  },
})
const { listAgentDevices } = await import('./boxes.ts')

test('default and explicit false device lists do not request metrics or sample this computer', async () => {
  assert.equal(await listAgentDevices(), list)
  assert.equal(await listAgentDevices({ metrics: false }), list)
  assert.deepEqual(calls, ['/agent/devices', '/agent/devices'])
  assert.equal(samples, 0)
})

test('explicit demand renews backend metrics and overlays only this computer', async () => {
  const result = await listAgentDevices({ metrics: true })

  assert.equal(calls.at(-1), '/agent/devices?metrics=true')
  assert.equal(samples, 1)
  assert.equal(result.devices[0]?.metrics, metrics)
  assert.equal(result.devices[0]?.metricsStatus, 'live')
  assert.ok(result.devices[0]?.metricsReceivedAt)
  assert.equal(
    result.devices[1],
    remote,
    'remote status and receipt timestamp pass through unchanged',
  )
})

test('Box IPC forwards optional metrics demand without changing the default', async () => {
  const { boxChannels } = await import('../main/channels-box.ts')

  await boxChannels['box:listDevices'](null, { metrics: true })
  assert.equal(calls.at(-1), '/agent/devices?metrics=true')
  await boxChannels['box:listDevices'](null, { metrics: true, teamId: 'team 1' })
  assert.equal(calls.at(-1), '/agent/devices?metrics=true&teamId=team+1')
  const before = samples

  await boxChannels['box:listDevices']()
  assert.equal(calls.at(-1), '/agent/devices')
  assert.equal(samples, before)
})

test('adding an agent posts once and outlasts the backend 60s host wait', async () => {
  const { boxChannels } = await import('../main/channels-box.ts')

  await boxChannels['box:createAgent'](null, 'box/1', 'team-1', 'codex')
  assert.equal(calls.at(-1), '/agent/devices/box%2F1/agents')
  assert.deepEqual(bodies.at(-1), { teamId: 'team-1', provider: 'codex' })
  assert.deepEqual(options.at(-1), { retry: false, timeoutMs: 65_000 })
})
