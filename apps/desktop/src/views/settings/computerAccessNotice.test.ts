import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  forgetSeen,
  freshAccess,
  noticeWords,
  parseSeenAccess,
  seenBefore,
  teamsToSeed,
} from './computerAccessNotice.ts'

import type { AgentDevice } from '../../api/device-types.ts'

const device = (deviceId: string, access: AgentDevice['access'], ownerUserId = 'maya') =>
  ({ deviceId, label: deviceId, platform: 'linux', access, ownerUserId }) as AgentDevice

test('the first list is remembered, not announced', () => {
  const { notices, next } = freshAccess(null, [device('box', 'use')], 'leo')

  assert.deepEqual(notices, [])
  assert.deepEqual(next, { box: 'use' })
})

test('a computer shared since the last look is announced once', () => {
  const first = freshAccess({}, [device('box', 'use')], 'leo')

  assert.deepEqual(
    first.notices.map((notice) => [notice.device.deviceId, notice.access]),
    [['box', 'use']],
  )
  assert.deepEqual(freshAccess(first.next, [device('box', 'use')], 'leo').notices, [])
})

test('being made a manager is news; being stepped down to Use is not', () => {
  assert.deepEqual(
    freshAccess({ box: 'use' }, [device('box', 'manage')], 'leo').notices.map((n) => n.access),
    ['manage'],
  )
  assert.deepEqual(freshAccess({ box: 'manage' }, [device('box', 'use')], 'leo').notices, [])
})

test('losing access and getting it back is announced again', () => {
  const removed = freshAccess({ box: 'use' }, [], 'leo')

  assert.deepEqual(removed.next, {})
  assert.equal(freshAccess(removed.next, [device('box', 'use')], 'leo').notices.length, 1)
})

test('your own computers and ones without an owner are never announced', () => {
  const { notices, next } = freshAccess(
    {},
    [
      device('mine', 'owner', 'leo'),
      device('also-mine', 'manage', 'leo'),
      device('old', 'use', ''),
    ],
    'leo',
  )

  assert.deepEqual(notices, [])
  assert.deepEqual(next, {})
})

test('a remembered list that cannot be read counts as nothing seen', () => {
  assert.equal(parseSeenAccess(null), null)
  assert.equal(parseSeenAccess('not json'), null)
  assert.equal(parseSeenAccess('[]'), null)
  assert.deepEqual(parseSeenAccess('{"a":"use","b":"owner","c":"manage"}'), {
    a: 'use',
    c: 'manage',
  })
})

test('a team first opened after the first look announces what it shares', () => {
  const shared = [device('box', 'use')]

  // The very first look anywhere: what is there already is not news.
  assert.deepEqual(freshAccess(seenBefore(null, false), shared, 'leo').notices, [])
  // A team opened later has seen nothing yet, so its share is announced.
  assert.equal(freshAccess(seenBefore(null, true), shared, 'leo').notices.length, 1)
  assert.deepEqual(seenBefore('{"box":"use"}', true), { box: 'use' })
})

test('the very first look saves a starting list for each other team with none yet', () => {
  const saved = new Set(['b'])

  assert.deepEqual(
    teamsToSeed(['a', 'b', 'c'], 'a', (teamId) => saved.has(teamId)),
    ['c'],
  )
  // Seeded with the share it already had, team c is quiet when first opened.
  const start = freshAccess(null, [device('box', 'use')], 'leo').next

  assert.deepEqual(
    freshAccess(seenBefore(JSON.stringify(start), true), [device('box', 'use')], 'leo').notices,
    [],
  )
})

test('a notice that could not be shown is forgotten, so the next look announces it again', () => {
  const left = forgetSeen(JSON.stringify({ mac: 'use', pc: 'manage' }), 'mac')

  assert.deepEqual(left, { pc: 'manage' })
  assert.deepEqual(freshAccess(left, [device('mac', 'use')], 'jeun').notices.length, 1)
  assert.equal(forgetSeen(null, 'mac'), null)
})

test('the notice names no one: a manager, not the owner, may have made the change', () => {
  const pc = { ...device('pc', 'use', 'maya'), label: 'Maya’s PC' }

  assert.equal(noticeWords({ device: pc, access: 'use' }).title, 'Maya’s PC is now shared with you')
  assert.equal(noticeWords({ device: pc, access: 'manage' }).title, 'You can now manage Maya’s PC')
})
