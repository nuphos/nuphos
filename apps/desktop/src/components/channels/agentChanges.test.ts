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

test("a backend without the push leaves the team's chats polling", () => {
  const client = createQueryClient()

  assert.equal(pushed('old'), true)
  applyChange(client, { teamId: 'old', sessionId: null, supported: false })
  assert.equal(pushed('old'), false)
  assert.equal(pushed('t'), true, 'other teams still need no poll')
  client.clear()
})
