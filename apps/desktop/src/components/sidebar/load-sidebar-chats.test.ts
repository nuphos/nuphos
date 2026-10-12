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

for (const scope of ['mine', 'shared'] as const) {
  test(`${scope} refresh moves an older active conversation above a newer idle one`, async () => {
    const older = { ...chat(1), createdAt: '2026-10-01T00:00:00Z' }
    const newer = { ...chat(2), createdAt: '2026-10-02T00:00:00Z' }
    let active = false
    const readPage: Parameters<typeof loadSidebarChats>[0] = async (options) => {
      assert.equal(options.sort, 'activity')
      assert.equal(options.scope, scope)
      assert.equal(options.archived, 'exclude')
      const ordered = active ? [older, newer] : [newer, older]

      return {
        conversations: [ordered[options.cursor ? 1 : 0]!],
        nextCursor: options.cursor ? null : 'next',
        hasMore: !options.cursor,
      }
    }
    const initial = await loadSidebarChats(readPage, () => true, scope)
    assert.deepEqual(initial?.map((row) => row.sessionId), ['2', '1'])
    active = true
    const refreshed = await loadSidebarChats(readPage, () => true, scope)
    assert.deepEqual(refreshed?.map((row) => row.sessionId), ['1', '2'])
  })
}
