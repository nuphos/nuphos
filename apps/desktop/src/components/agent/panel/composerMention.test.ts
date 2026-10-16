import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deviceDetail,
  matchDevices,
  matchMembers,
  mentionQuery,
  sessionMentionUrl,
} from './composerMention.ts'

import type { TeamMember } from '../../../types'

const member = (id: string, name: string, email: string, removedAt?: string) =>
  ({
    id,
    name,
    username: id,
    email,
    avatarURL: '',
    role: 'EDITOR',
    joinedAt: '',
    removedAt,
  }) as TeamMember

test('a mention starts at a line start or after whitespace, never inside a word', () => {
  assert.equal(mentionQuery('@'), '')
  assert.equal(mentionQuery('hey @ali'), 'ali')
  assert.equal(mentionQuery('line\n@bo'), 'bo')
  assert.equal(mentionQuery('mail me at a@b'), null)
  assert.equal(mentionQuery('@alice done'), null)
})

test('members match by name or email, case-insensitively, skipping removed ones', () => {
  const members = [
    member('a', 'Alice Chen', 'alice@example.test'),
    member('b', 'Bob', 'bob@zeabur.com'),
    member('c', 'Carol', 'carol@zeabur.com', '2026-01-01'),
  ]

  assert.deepEqual(
    matchMembers(members, 'ALI').map((m) => m.id),
    ['a'],
  )
  assert.deepEqual(
    matchMembers(members, 'zeabur').map((m) => m.id),
    ['b'],
  )
  assert.deepEqual(
    matchMembers(members, '').map((m) => m.id),
    ['a', 'b'],
  )
})

test("a session mention is the session's canonical link", () => {
  assert.equal(sessionMentionUrl('t1', 's/1'), 'https://nuphos.ai/teams/t1/agent/s%2F1')
})

test('devices match by label, case-insensitively', () => {
  const devices = [
    { deviceId: 'd1', label: "Ann's MacBook Pro", platform: 'darwin' },
    { deviceId: 'd2', label: 'build-box', platform: 'linux' },
  ]

  assert.deepEqual(
    matchDevices(devices, 'macbook').map((d) => d.deviceId),
    ['d1'],
  )
  assert.equal(matchDevices(devices, '').length, 2)
})

const mac = (deviceId: string, available?: boolean) => ({
  deviceId,
  label: 'MacBook-Pro.local',
  platform: 'darwin',
  available,
})

test('a device only gets a detail when another one has the same label', () => {
  const devices = [mac('aaaa1111', true), mac('bbbb2222', false)]

  assert.equal(deviceDetail(devices[0], devices), 'Online · 1111')
  assert.equal(deviceDetail(devices[1], devices), 'Offline · 2222')
  assert.equal(deviceDetail(devices[0], [devices[0]]), '')
})
