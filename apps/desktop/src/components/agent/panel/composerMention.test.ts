import assert from 'node:assert/strict'
import test from 'node:test'

import { matchMembers, mentionQuery } from './composerMention.ts'

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
