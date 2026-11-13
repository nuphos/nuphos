import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextBotAfterArchive } from './archiveBotSelection.ts'

import type { Item } from './types'

const row = (id: string, extra: Partial<Item> = {}): Item => ({
  key: `agent-session:${id}`,
  label: id,
  enabled: true,
  ...extra,
})

test('archiving the selected Bot chooses the next available top-level Bot', () => {
  const rows = [row('a', { bot: true }), row('child', { botNested: true }), row('b', { bot: true })]

  assert.equal(nextBotAfterArchive(rows, 'a', 'a', new Set())?.key, 'agent-session:b')
})
test('archiving another Bot does not change focus', () => {
  assert.equal(nextBotAfterArchive([row('a'), row('b')], 'a', 'b', new Set()), undefined)
})
test('skip the archived Bot own chat and any other archive in flight', () => {
  const rows = [row('chat', { botChannelOf: 'a' }), row('a', { bot: true }), row('b'), row('c')]

  assert.equal(nextBotAfterArchive(rows, 'chat', 'chat', new Set(['b']))?.key, 'agent-session:c')
})
test('the final Bot leaves no replacement and disabled rows are not opened', () => {
  assert.equal(
    nextBotAfterArchive([row('a'), row('b', { enabled: false })], 'a', 'a', new Set()),
    undefined,
  )
})
