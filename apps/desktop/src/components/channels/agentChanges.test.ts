import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyChange, pushed } from './agentChanges.ts'

const { createQueryClient } = await import('../../lib/query/client.ts')
const { queryKeys } = await import('../../lib/query/keys.ts')

test('a change reads that chat again; a reconnect reads every chat of the team again', async () => {
  const client = createQueryClient()
  const keys = [
    queryKeys.channel('t', 'a'),
    queryKeys.channel('t', 'b'),
    queryKeys.channel('u', 'a'),
  ]

  for (const key of keys) client.setQueryData(key, { revision: 'r' })
  const stale = () => keys.map((key) => client.getQueryState(key)?.isInvalidated === true)

  applyChange(client, { teamId: 't', sessionId: 'a' })
  assert.deepEqual(stale(), [true, false, false], 'only the chat that changed')
  applyChange(client, { teamId: 't', sessionId: null })
  assert.deepEqual(stale(), [true, true, false], 'every chat of that team, no other')
  client.clear()
})

test("a Bot's change reads every chat it is a member of again", () => {
  const client = createQueryClient()
  const withBot = queryKeys.channel('t', 'with-bot')
  const without = queryKeys.channel('t', 'without')

  client.setQueryData(withBot, { revision: 'r', agents: [{ sessionId: 'bot' }] })
  client.setQueryData(without, { revision: 'r', agents: [{ sessionId: 'other' }] })
  applyChange(client, { teamId: 't', sessionId: 'bot' })
  assert.equal(client.getQueryState(withBot)?.isInvalidated, true, 'its name and face show there')
  assert.equal(client.getQueryState(without)?.isInvalidated, false)
  client.clear()
})

test('being told again that the push is up reads nothing again', () => {
  const client = createQueryClient()
  const key = queryKeys.channel('again', 'a')

  applyChange(client, { teamId: 'again', sessionId: null, connected: true })
  client.setQueryData(key, { revision: 'r' })
  applyChange(client, { teamId: 'again', sessionId: null, connected: true })
  assert.equal(client.getQueryState(key)?.isInvalidated, false, 'a view that asks to follow later')
  applyChange(client, { teamId: 'again', sessionId: null, connected: false })
  assert.equal(client.getQueryState(key)?.isInvalidated, true, 'going down reads it again')
  client.clear()
})

test('a team polls until its stream is up, and again while it is down', () => {
  const client = createQueryClient()

  assert.equal(
    pushed('down'),
    false,
    'before the first connect (an error, a blocked stream, an old backend)',
  )
  applyChange(client, { teamId: 'down', sessionId: null, connected: true })
  assert.equal(pushed('down'), true, 'up: no poll')
  applyChange(client, { teamId: 'down', sessionId: 'a' })
  assert.equal(pushed('down'), true, 'a change keeps it up')
  applyChange(client, { teamId: 'down', sessionId: null, connected: false })
  assert.equal(pushed('down'), false, 'down: polls again')
  assert.equal(pushed('never'), false, 'a team whose stream never came up polls')
  client.clear()
})
