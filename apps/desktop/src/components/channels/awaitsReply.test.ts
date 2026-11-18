import assert from 'node:assert/strict'
import { test } from 'node:test'

import { awaitsReply } from './awaitsReply.ts'

const post = (id: string, at: string, sender: object, text = 'hi', extra: object = {}) => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
  metadata: { version: 1, source: 'nuphos', sentAt: at, sender, ...extra },
})
const person = { type: 'user', id: 'u1', displayName: 'Mei' }
const scribe = { type: 'agent', id: 'scribe', displayName: 'Scribe' }
const failed = (at: string) => ({ kind: 'agent_reply_failed', at, text: '', agentId: 'scribe' })

test("any person's post in a Bot's own chat waits on it until it posts", () => {
  const asked = [post('p1', '2026-11-18T01:00:00Z', person)]

  assert.equal(awaitsReply('scribe', asked as never, [], true), true)
  assert.equal(
    awaitsReply(
      'scribe',
      [...asked, post('p2', '2026-11-18T01:01:00Z', scribe)] as never,
      [],
      true,
    ),
    false,
  )
})

test('in a group, only an @mention or a reply to its post waits on a Bot', () => {
  const plain = post('p1', '2026-11-18T01:00:00Z', person)
  const mention = post(
    'p2',
    '2026-11-18T01:01:00Z',
    person,
    'https://nuphos.ai/teams/t/agent/scribe can you?',
  )
  const own = post('p3', '2026-11-18T01:02:00Z', scribe)
  const reply = post('p4', '2026-11-18T01:03:00Z', person, 'thanks', {
    replyTo: { id: 'p3', authorName: 'Scribe', text: 'hi' },
  })

  assert.equal(awaitsReply('scribe', [plain] as never, [], false), false)
  assert.equal(awaitsReply('scribe', [plain, mention] as never, [], false), true)
  assert.equal(awaitsReply('scribe', [mention, own] as never, [], false), false)
  assert.equal(awaitsReply('scribe', [mention, own, reply] as never, [], false), true)
})

test("its couldn't-reply line ends the wait", () => {
  const asked = [post('p1', '2026-11-18T01:00:00Z', person)]

  assert.equal(awaitsReply('scribe', asked as never, [failed('2026-11-18T01:02:00Z')], true), false)
  assert.equal(awaitsReply('scribe', asked as never, [failed('2026-11-18T00:59:00Z')], true), true)
})
