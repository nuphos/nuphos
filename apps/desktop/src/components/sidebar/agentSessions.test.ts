import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { QueryObserver } from '@tanstack/react-query'

import type { AgentConversation } from '../../api/agent-types.ts'

type Page = { conversations: AgentConversation[]; nextCursor: null }
// The next listing's rows; the four listings of one load all read them, channels excluded.
let next: () => Promise<AgentConversation[]> = async () => []

mock.module('../../api.ts', {
  namedExports: {
    api: {
      agentListConversations: async (_team: string, options: { kind?: string }): Promise<Page> => ({
        conversations: options.kind ? [] : await next(),
        nextCursor: null,
      }),
    },
  },
})

const { createQueryClient } = await import('../../lib/query/client.ts')
const { queryKeys } = await import('../../lib/query/keys.ts')
const { removeChat, restoreChat } = await import('./agentSessions.ts')
const { loadSidebarChats } = await import('./load-sidebar-chats.ts')
const { api } = await import('../../api.ts')

const chat = (sessionId: string, lastActiveAt: string) =>
  ({ sessionId, lastActiveAt }) as AgentConversation
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** The Chats list as a screen shows it, loaded once with `rows`. */
async function shown(rows: AgentConversation[]) {
  next = async () => rows
  const client = createQueryClient()
  const observer = new QueryObserver(client, {
    queryKey: queryKeys.agentSessions('t'),
    queryFn: async () =>
      (await loadSidebarChats(
        (o) => api.agentListConversations('t', o),
        () => true,
      )) ?? [],
  })
  const stop = observer.subscribe(() => {})

  await settle()

  return { client, ids: () => observer.getCurrentResult().data?.map((row) => row.sessionId), stop }
}

test('an older listing after archive does not bring the row back', async () => {
  const list = await shown([chat('a', '2'), chat('b', '1')])
  const older = Promise.withResolvers<AgentConversation[]>()

  // A poll that started before the archive landed, so it still has the row.
  next = () => older.promise
  void list.client.refetchQueries({ queryKey: queryKeys.agentSessions('t') })
  await settle()
  next = async () => [chat('b', '1')]
  await removeChat(list.client, 't', 'a')
  older.resolve([chat('a', '2'), chat('b', '1')])
  await settle()
  assert.deepEqual(list.ids(), ['b'])
  list.stop()
  list.client.clear()
})

test('Undo lists the chat again at once, in activity order, before any listing has it', async () => {
  const list = await shown([chat('x', '3'), chat('z', '1')])
  const older = Promise.withResolvers<AgentConversation[]>()

  next = () => older.promise
  const restoring = restoreChat(list.client, 't', chat('y', '2'))

  await settle()
  assert.deepEqual(list.ids(), ['x', 'y', 'z'])
  older.resolve([chat('x', '3'), chat('y', '2'), chat('z', '1')])
  await restoring
  assert.deepEqual(list.ids(), ['x', 'y', 'z'])
  list.stop()
  list.client.clear()
})
