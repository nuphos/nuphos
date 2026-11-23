import assert from 'node:assert/strict'
import test from 'node:test'

import { loadSidebarChats } from './load-sidebar-chats.ts'
import { nestItems } from './nest-items.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

const chat = (id: number) => ({ sessionId: String(id) }) as AgentConversation

test('sidebar loads all pages, preserves order and deduplicates overlapping pages', async () => {
  const cursors: (string | undefined)[] = []
  const rows = await loadSidebarChats(
    async (options) => {
      if (options.kind === 'channel' || options.scope === 'shared')
        return { conversations: [], nextCursor: null, hasMore: false }
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

test('refresh moves an older active conversation above a newer idle one', async () => {
  const older = { ...chat(1), createdAt: '2026-10-01T00:00:00Z' }
  const newer = { ...chat(2), createdAt: '2026-10-02T00:00:00Z' }
  let active = false
  const readPage: Parameters<typeof loadSidebarChats>[0] = async (options) => {
    if (options.kind === 'channel' || options.scope === 'shared')
      return { conversations: [], nextCursor: null, hasMore: false }
    assert.equal(options.sort, 'activity')
    assert.equal(options.scope, 'mine')
    assert.equal(options.archived, 'exclude')
    const ordered = active ? [older, newer] : [newer, older]

    return {
      conversations: [ordered[options.cursor ? 1 : 0]!],
      nextCursor: options.cursor ? null : 'next',
      hasMore: !options.cursor,
    }
  }
  const initial = await loadSidebarChats(readPage, () => true)

  assert.deepEqual(
    initial?.map((row) => row.sessionId),
    ['2', '1'],
  )
  active = true
  const refreshed = await loadSidebarChats(readPage, () => true)

  assert.deepEqual(
    refreshed?.map((row) => row.sessionId),
    ['1', '2'],
  )
})

test('channels come from their own listing, every page of it', async () => {
  const asked: string[] = []
  const rows = await loadSidebarChats(
    async (options) => {
      asked.push(`${options.scope}:${options.kind ?? ''}:${options.cursor ?? ''}`)
      if (options.kind !== 'channel')
        return { conversations: [chat(1)], nextCursor: null, hasMore: false }

      return options.cursor
        ? {
            conversations: [{ sessionId: 'c2', kind: 'channel' }] as AgentConversation[],
            nextCursor: null,
            hasMore: false,
          }
        : {
            conversations: [{ sessionId: 'c1', kind: 'channel' }] as AgentConversation[],
            nextCursor: 'more',
            hasMore: true,
          }
    },
    () => true,
  )

  assert.deepEqual(
    rows?.map((row) => row.sessionId),
    ['1', 'c1', 'c2'],
  )
  assert.deepEqual(asked, [
    'mine::',
    'shared::',
    'mine:channel:',
    'mine:channel:more',
    'shared:channel:',
    'shared:channel:more',
  ])
})

const at = (id: string, lastActiveAt: string, extra: Partial<AgentConversation> = {}) =>
  ({ sessionId: id, lastActiveAt, ...extra }) as AgentConversation
const page = (conversations: AgentConversation[]) => ({
  conversations,
  nextCursor: null,
  hasMore: false,
})

test("shared agents and channels sit among the viewer's own, by recent activity", async () => {
  const rows = await loadSidebarChats(
    async (options) => {
      if (options.kind === 'channel')
        return page(
          options.scope === 'mine' ? [at('c1', '2026-11-03T12:00:00Z', { kind: 'channel' })] : [],
        )
      if (options.scope === 'shared') return page([at('shared', '2026-11-02T00:00:00Z')])

      return page([at('newest', '2026-11-03T00:00:00Z'), at('oldest', '2026-11-01T00:00:00Z')])
    },
    () => true,
  )

  assert.deepEqual(
    rows?.map((row) => row.sessionId),
    ['c1', 'newest', 'shared', 'oldest'],
  )
})

test('a sub-agent shared with the viewer nests under its shared parent', async () => {
  const rows = await loadSidebarChats(
    async (options) => {
      if (options.kind === 'channel' || options.scope === 'mine') return page([])

      return page([
        at('child', '2026-11-03T00:00:00Z', { parentSessionId: 'parent' }),
        at('parent', '2026-11-02T00:00:00Z'),
      ])
    },
    () => true,
  )
  const nested = nestItems(
    (rows ?? []).map((row) => ({
      key: `agent-session:${row.sessionId}`,
      ...(row.parentSessionId ? { parentKey: `agent-session:${row.parentSessionId}` } : {}),
    })),
  )

  assert.deepEqual(
    nested.map(({ item, depth }) => [item.key, depth]),
    [
      ['agent-session:parent', 0],
      ['agent-session:child', 1],
    ],
  )
})

const dated = (id: number, time: string) =>
  ({ ...chat(id), lastActiveAt: time }) as AgentConversation

test('a poll with listed rows reads only each first page and keeps rows from later pages', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) =>
    dated(i, `2026-11-22T10:${String(59 - (i % 60)).padStart(2, '0')}:00Z`),
  ).toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  const later = dated(500, '2026-11-01T00:00:00Z')
  const gone = dated(600, '2026-11-22T11:00:00Z')
  const requests: (string | undefined)[] = []
  const readPage: Parameters<typeof loadSidebarChats>[0] = async (options) => {
    requests.push(options.cursor)
    if (options.kind === 'channel' || options.scope === 'shared')
      return { conversations: [], nextCursor: null, hasMore: false }

    return options.cursor
      ? { conversations: [later], nextCursor: null, hasMore: false }
      : { conversations: page1, nextCursor: 'next', hasMore: true }
  }

  const full = await loadSidebarChats(readPage, () => true)

  assert.equal(requests.length, 5)
  assert.ok(full?.some((row) => row.sessionId === '500'))

  requests.length = 0
  const polled = await loadSidebarChats(readPage, () => true, [...(full ?? []), gone])

  assert.deepEqual(requests, [undefined, undefined, undefined, undefined])
  assert.ok(
    polled?.some((row) => row.sessionId === '500'),
    'a later page is kept',
  )
  assert.ok(
    !polled?.some((row) => row.sessionId === '600'),
    'a row newer than the first page is gone',
  )
  assert.equal(polled?.length, full?.length)
})

test('a poll of listings that fit on one page drops every row they no longer list', async () => {
  const polled = await loadSidebarChats(
    async (options) => ({
      conversations: options.kind || options.scope === 'shared' ? [] : [chat(1)],
      nextCursor: null,
      hasMore: false,
    }),
    () => true,
    [chat(1), chat(2)],
  )

  assert.deepEqual(
    polled?.map((row) => row.sessionId),
    ['1'],
  )
})
