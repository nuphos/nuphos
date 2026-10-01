import assert from 'node:assert/strict'
import test from 'node:test'

import { loadSidebarChats } from './load-sidebar-chats.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

const chat = (id: number) => ({ sessionId: String(id) }) as AgentConversation

test('sidebar loads all pages, preserves order and deduplicates overlapping pages', async () => {
  const cursors: (string | undefined)[] = []
  const rows = await loadSidebarChats(
    async (options) => {
      cursors.push(options.cursor)

      return options.cursor
        ? { conversations: [chat(99), chat(100), chat(101)], nextCursor: null, hasMore: false }
        : {
            conversations: Array.from({ length: 100 }, (_, i) => chat(i)),
            nextCursor: 'next',
            hasMore: true,
          }
    },
    () => true,
  )

  assert.equal(rows?.length, 102)
  assert.equal(rows?.at(-1)?.sessionId, '101')
  assert.deepEqual(cursors, [undefined, 'next'])
})
test('team switches discard the old result before requesting more pages', async () => {
  let calls = 0
  const rows = await loadSidebarChats(
    async () => {
      calls++

      return { conversations: [chat(1)], nextCursor: 'next', hasMore: true }
    },
    () => false,
  )

  assert.equal(rows, null)
  assert.equal(calls, 1)
})
test('a repeated cursor fails instead of looping forever or silently truncating the list', async () => {
  await assert.rejects(
    loadSidebarChats(
      async () => ({ conversations: [], nextCursor: 'same', hasMore: true }),
      () => true,
    ),
    /Repeated conversation cursor/,
  )
})
