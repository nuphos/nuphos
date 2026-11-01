import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chatNavKey, chatRowNeedsAttention, chatRowToward } from './chat-nav.ts'

import type { Item, Section } from './types'

const chat = (id: string, extra: Partial<Item> = {}): Item => ({
  key: `agent-session:${id}`,
  label: id,
  enabled: true,
  ...extra,
})
const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...mods,
})
const open = () => false
const ids = (item: Item | undefined) => item?.key.slice('agent-session:'.length)
const hasDot = (item: Item) => Boolean(item.dot)

test('chatNavKey reads ⌥↑/⌥↓ and the ⇧ attention variant only', () => {
  assert.deepEqual(chatNavKey(key('ArrowDown')), { step: 1, attentionOnly: false })
  assert.deepEqual(chatNavKey(key('ArrowUp', { shiftKey: true })), {
    step: -1,
    attentionOnly: true,
  })
  assert.equal(chatNavKey(key('ArrowDown', { altKey: false })), null)
  assert.equal(chatNavKey(key('ArrowDown', { metaKey: true })), null)
  assert.equal(chatNavKey(key('ArrowLeft')), null)
  // Monaco and xterm claim the key first.
  assert.equal(chatNavKey(key('ArrowDown', { defaultPrevented: true })), null)
  assert.equal(chatNavKey(key('ArrowDown', { isComposing: true })), null)
})

test('steps through chat rows across sections in sidebar order, stopping at the ends', () => {
  const sections: Section[] = [
    { items: [{ key: 'team.inbox', label: 'Inbox', enabled: true }] },
    { title: 'Pinned', items: [chat('p')] },
    { title: 'Agents', items: [chat('a', { active: true }), chat('b')] },
  ]

  assert.equal(ids(chatRowToward(sections, open, 1)), 'b')
  assert.equal(ids(chatRowToward(sections, open, -1)), 'p')
  sections[2].items = [chat('a'), chat('b', { active: true })]
  assert.equal(chatRowToward(sections, open, 1), undefined)
})

test('with no open chat, down starts at the top and up at the bottom', () => {
  const sections: Section[] = [{ title: 'Agents', items: [chat('a'), chat('b'), chat('c')] }]

  assert.equal(ids(chatRowToward(sections, open, 1)), 'a')
  assert.equal(ids(chatRowToward(sections, open, -1)), 'c')
})

test('skips collapsed groups and folded threads; a folded parent stands in for its open thread', () => {
  const sections: Section[] = [
    { title: 'Pinned', items: [chat('p')] },
    {
      title: 'Agents',
      items: [chat('a'), chat('t', { parentKey: 'agent-session:a', active: true }), chat('b')],
    },
  ]
  const folded = ({ title }: Pick<Section, 'title'>) =>
    title === 'Pinned' || title === 'agent-session:a'

  assert.equal(ids(chatRowToward(sections, folded, 1)), 'b')
  assert.equal(chatRowToward(sections, folded, -1), undefined)
})

test('the attention filter skips rows that need nothing', () => {
  const sections: Section[] = [
    { title: 'Agents', items: [chat('a', { active: true }), chat('b'), chat('c')] },
  ]

  assert.equal(ids(chatRowToward(sections, open, 1, (item) => item.key.endsWith('c'))), 'c')
  assert.equal(
    chatRowToward(sections, open, 1, () => false),
    undefined,
  )
})

const idle = { state: 'idle', schemaVersion: 2 } as const
const failed = { ...idle, phase: 'failed' } as const
const turn = { state: 'active', schemaVersion: 2, phase: 'running' } as const
const background = { ...idle, phase: 'background_tools' } as const

test('attention follows what the row shows: its dot or its error mark', () => {
  assert.equal(chatRowNeedsAttention({ dot: 'unread' }, idle), true)
  assert.equal(chatRowNeedsAttention({ dot: 'waiting' }, idle), true)
  assert.equal(chatRowNeedsAttention({ dot: null }, idle), false)
  assert.equal(chatRowNeedsAttention({}, idle), false)
  assert.equal(chatRowNeedsAttention({ dot: null }, failed), true)
})

test('an open question needs attention while working, an unread reply does not', () => {
  assert.equal(chatRowNeedsAttention({ dot: 'waiting' }, turn), true)
  assert.equal(chatRowNeedsAttention({ dot: 'waiting' }, background), true)
  assert.equal(chatRowNeedsAttention({ dot: 'unread' }, turn), false)
  assert.equal(chatRowNeedsAttention({ dot: 'unread' }, background), false)
})

test('the attention filter stops at a folded parent for a row it hides', () => {
  const sections: Section[] = [
    {
      title: 'Agents',
      items: [
        chat('open', { active: true }),
        chat('parent'),
        chat('kid', { parentKey: 'agent-session:parent', dot: 'waiting' }),
        chat('last', { dot: 'unread' }),
      ],
    },
  ]
  const folded = (section: Pick<Section, 'title'>) => section.title === 'agent-session:parent'

  assert.equal(ids(chatRowToward(sections, folded, 1, hasDot)), 'parent')
  assert.equal(ids(chatRowToward(sections, open, 1, hasDot)), 'kid')
})
