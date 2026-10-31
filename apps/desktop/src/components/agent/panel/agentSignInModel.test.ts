import assert from 'node:assert/strict'
import { test } from 'node:test'

import { lastSentText, localRuntimeOwner, signInRoute } from './agentSignInModel.ts'

import type { Message } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'
import type { TeamMember } from '../../../types/team.ts'

const managed: RuntimeInstance = {
  id: 'runtime-production-4733',
  provider: 'claude-code',
  label: 'runtime-production-4733',
  status: 'active',
  kind: 'managed',
  createdAt: '2026-01-01T00:00:00Z',
}

function member(id: string, role: TeamMember['role'], joinedAt: string): TeamMember {
  return { id, name: `Name ${id}`, email: `${id}@example.com`, username: id, role, joinedAt }
}

const members = [
  member('u-late-admin', 'ADMINISTRATOR', '2026-03-01T00:00:00Z'),
  member('u-editor', 'EDITOR', '2026-01-01T00:00:00Z'),
  member('u-first-admin', 'ADMINISTRATOR', '2026-02-01T00:00:00Z'),
]

const base = {
  runtimeId: managed.id,
  viewerId: 'u-editor',
  isTeamAdmin: false,
  onThisComputer: false,
  instance: managed,
  members,
}

test('an administrator signs a team agent in right from the card', () => {
  assert.deepEqual(signInRoute({ ...base, isTeamAdmin: true }), {
    kind: 'dialog',
    instance: managed,
  })
})

test('a member is told which administrator to ask', () => {
  assert.deepEqual(signInRoute(base), { kind: 'ask', name: 'Name u-first-admin' })
  assert.deepEqual(signInRoute({ ...base, members: null }), { kind: 'ask', name: null })
})

test('a development agent has no sign-in to start, so the settings button stays', () => {
  const development = { ...managed, kind: 'development' as const }

  assert.deepEqual(signInRoute({ ...base, isTeamAdmin: true, instance: development }), {
    kind: 'none',
  })
})

test("a member's own computer is theirs to sign in; anyone else asks them", () => {
  const runtimeId = 'local_u-editor_dev-1'
  const instance = { ...managed, id: runtimeId, kind: 'local' as const }

  assert.equal(localRuntimeOwner(runtimeId), 'u-editor')
  assert.deepEqual(signInRoute({ ...base, runtimeId, instance }), { kind: 'dialog', instance })
  assert.deepEqual(
    signInRoute({ ...base, runtimeId, instance, viewerId: 'u-first-admin', isTeamAdmin: true }),
    { kind: 'ask', name: 'Name u-editor' },
  )
})

test("this computer's agent signs in through its own CLI", () => {
  const route = (runtimeId: string) => signInRoute({ ...base, runtimeId, onThisComputer: true })

  assert.deepEqual(route('local_u-editor_dev-1'), { kind: 'cli', provider: 'claude-code' })
  assert.deepEqual(route('local_u-editor_dev-1_codex'), { kind: 'cli', provider: 'codex' })
  assert.deepEqual(route('local_u-editor_dev-1_grok'), { kind: 'none' })
})

test('the last message you sent is what gets resent', () => {
  const messages = [
    { id: '1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
    { id: '2', role: 'user', parts: [{ type: 'text', text: ' ello ' }] },
    { id: '3', role: 'assistant', parts: [{ type: 'text', text: 'Turn failed.' }] },
  ] as unknown as Message[]

  assert.equal(lastSentText(messages), 'ello')
  assert.equal(lastSentText([]), null)
  assert.equal(
    lastSentText([
      { id: '4', role: 'user', turnKind: 'plan-approval', parts: [] },
    ] as unknown as Message[]),
    null,
  )
})
