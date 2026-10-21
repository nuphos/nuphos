import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: unknown[][] = []

mock.module('../atlas/client.ts', {
  namedExports: {
    readToken: async () => null,
    call: (...args: unknown[]) => {
      calls.push(args)

      return Promise.resolve({})
    },
  },
})
const { boxChannels } = await import('./channels-box.ts')

test('Box IPC channels scope the list and every Box action to the page team', async () => {
  await boxChannels['box:listDevices']()
  await boxChannels['box:listDevices'](null, { teamId: 'team-1' })
  await boxChannels['box:create'](null, 'demo', 'team-1')
  await boxChannels['box:create'](null, undefined, 'team-1')
  await boxChannels['box:create'](null, undefined, 'team-1', 8)
  await boxChannels['box:create'](null, 'demo', 'team-1', 4, { everyone: true, userIds: [] })
  await boxChannels['box:pause'](null, 'dev/1', 'team-1')
  await boxChannels['box:resume'](null, 'dev/1', 'team-1')
  await boxChannels['box:delete'](null, 'dev/1', 'team-1')
  await boxChannels['box:removeDevice'](null, 'dev/1', 'team-1')
  await boxChannels['box:desktop'](null, 'dev/1', 'team-1')
  await boxChannels['box:rename'](null, 'dev/1', 'team-1', 'Build Box')
  await boxChannels['box:createAgent'](null, 'dev/1', 'team-1', 'codex')
  await boxChannels['box:renameAgent'](null, 'dev/1', 'team-1', 'claude-code', 'Main')
  await boxChannels['box:setAccess'](null, 'dev/1', 'team-1', { everyone: false, userIds: ['u1'] })

  assert.deepEqual(
    calls.map(([method, route, body]) => [method, route, body]),
    [
      ['GET', '/agent/devices', undefined],
      ['GET', '/agent/devices?teamId=team-1', undefined],
      ['POST', '/agent/devices/boxes', { teamId: 'team-1', label: 'demo' }],
      ['POST', '/agent/devices/boxes', { teamId: 'team-1' }],
      ['POST', '/agent/devices/boxes', { teamId: 'team-1', vcpus: 8 }],
      [
        'POST',
        '/agent/devices/boxes',
        { teamId: 'team-1', label: 'demo', vcpus: 4, access: { everyone: true, userIds: [] } },
      ],
      ['POST', '/agent/devices/dev%2F1/box/pause?teamId=team-1', undefined],
      ['POST', '/agent/devices/dev%2F1/box/resume?teamId=team-1', undefined],
      ['DELETE', '/agent/devices/dev%2F1/box?teamId=team-1', undefined],
      ['DELETE', '/agent/devices/dev%2F1?teamId=team-1', undefined],
      ['POST', '/agent/devices/dev%2F1/box/desktop?teamId=team-1', undefined],
      ['PATCH', '/agent/devices/dev%2F1?teamId=team-1', { label: 'Build Box' }],
      ['POST', '/agent/devices/dev%2F1/agents', { teamId: 'team-1', provider: 'codex' }],
      ['PATCH', '/agent/devices/dev%2F1/agents/claude-code', { teamId: 'team-1', label: 'Main' }],
      [
        'PUT',
        '/agent/devices/dev%2F1/box/access?teamId=team-1',
        { everyone: false, userIds: ['u1'] },
      ],
    ],
  )
})

test('Box IPC channels reject arguments that are not strings', () => {
  assert.throws(() => boxChannels['box:pause'](null, 42, 'team-1'), TypeError)
  // A Box action without its team never reaches the backend.
  const untyped = boxChannels['box:pause'] as (...args: unknown[]) => unknown

  assert.throws(() => untyped(null, 'dev/1'), TypeError)
  assert.throws(() => boxChannels['box:rename'](null, 'dev/1', undefined, 'x'), TypeError)
  assert.throws(
    () => boxChannels['box:setAccess'](null, 'dev/1', 'team-1', { everyone: 'yes', userIds: [] }),
    TypeError,
  )
  assert.throws(() => boxChannels['box:create'](null, 'team-1', {}), TypeError)
})
