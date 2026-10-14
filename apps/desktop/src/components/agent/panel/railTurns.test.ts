import assert from 'node:assert/strict'
import test from 'node:test'

import { firstLine, pickRailTurns, previewText, turnPreview } from './railTurns.ts'

import type { Message } from './model.ts'

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}) =>
  ({ id, role, parts: text ? [{ type: 'text', text }] : [], ...extra }) as Message

const transcript = [
  msg('u1', 'user', 'Deploy staging\nwith the new chart'),
  msg('a1', 'assistant', 'Deployed **staging**.'),
  msg('a1b', 'assistant', 'All pods ready.', { turnOrigin: 'autonomous' }),
  msg('u2', 'user', 'Thanks'),
]

test('one turn per user message, owning the assistant replies that follow it', () => {
  assert.deepEqual(
    pickRailTurns(transcript).map((t) => [t.id, t.title, t.messageIds]),
    [
      ['u1', 'Deploy staging', ['u1', 'a1', 'a1b']],
      ['u2', 'Thanks', ['u2']],
    ],
  )
})

test('a turn preview joins only its own replies', () => {
  const [first, second] = pickRailTurns(transcript)

  assert.equal(turnPreview(transcript, first), 'Deployed staging. All pods ready.')
  assert.equal(turnPreview(transcript, second), '')
})

test('assistant messages before the first user message are ignored', () => {
  const turns = pickRailTurns([msg('a0', 'assistant', 'Resumed'), msg('u1', 'user', 'Hi')])

  assert.deepEqual(
    turns.map((t) => t.id),
    ['u1'],
  )
})

test('plan approvals and attachment-only turns get readable titles', () => {
  const turns = pickRailTurns([
    msg('u1', 'user', 'approve', { turnKind: 'plan-approval' }),
    msg('u2', 'user', ''),
  ])

  assert.deepEqual(
    turns.map((t) => t.title),
    ['Plan approval', 'Attachment'],
  )
})

test('first line skips blank lines and markdown markers, and is clipped', () => {
  assert.equal(firstLine('\n\n## Why is prod down?\nmore'), 'Why is prod down?')
  assert.equal(firstLine('- list item'), 'list item')
  assert.equal(firstLine('x'.repeat(200)).length, 80)
})

test('preview drops code blocks and link syntax and collapses whitespace', () => {
  assert.equal(
    previewText('See [the docs](https://x.y).\n\n```sh\nrm -rf /\n```\nDone `ok`.'),
    'See the docs. Done ok.',
  )
  assert.ok(previewText('word '.repeat(100)).endsWith('…'))
})
