import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: unknown[][] = []

mock.module('../atlas/client.ts', {
  namedExports: {
    call: (...args: unknown[]) => {
      calls.push(args)

      return Promise.resolve({})
    },
  },
})
const { boxChannels } = await import('./channels-box.ts')

test('Box IPC channels call the personal device routes', async () => {
  await boxChannels['box:listDevices']()
  await boxChannels['box:create'](null, 'demo', 'team-1')
  await boxChannels['box:create'](null, undefined, 'team-1')
  await boxChannels['box:pause'](null, 'dev/1')
  await boxChannels['box:resume'](null, 'dev/1')
  await boxChannels['box:delete'](null, 'dev/1')

  assert.deepEqual(
    calls.map(([method, route, body]) => [method, route, body]),
    [
      ['GET', '/agent/devices', undefined],
      ['POST', '/agent/devices/boxes', { teamId: 'team-1', label: 'demo' }],
      ['POST', '/agent/devices/boxes', { teamId: 'team-1' }],
      ['POST', '/agent/devices/dev%2F1/box/pause', undefined],
      ['POST', '/agent/devices/dev%2F1/box/resume', undefined],
      ['DELETE', '/agent/devices/dev%2F1/box', undefined],
    ],
  )
})

test('Box IPC channels reject arguments that are not strings', () => {
  assert.throws(() => boxChannels['box:pause'](null, 42), TypeError)
  assert.throws(() => boxChannels['box:create'](null, 'team-1', {}), TypeError)
})
