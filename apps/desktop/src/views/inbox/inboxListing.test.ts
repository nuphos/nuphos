import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { QueryObserver } from '@tanstack/react-query'

import type { AgentConversation } from '../../api/agent-types.ts'

type Page = { conversations: AgentConversation[]; nextCursor: null }
const pages: Promise<Page>[] = []

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { addEventListener: () => {}, removeEventListener: () => {} },
})
mock.module('../../api.ts', {
  namedExports: { api: { agentListConversations: () => pages.shift() } },
})

const { createQueryClient } = await import('../../lib/query/client.ts')
const { inboxListingQuery } = await import('./useInbox.ts')

const page = (sessionId: string) =>
  ({ conversations: [{ sessionId } as AgentConversation], nextCursor: null }) as Page

test('a slow older listing never replaces a newer one', async () => {
  const client = createQueryClient()
  const shown = new QueryObserver(client, inboxListingQuery('team'))
  const stop = shown.subscribe(() => {})
  const slow = Promise.withResolvers<Page>()

  pages.push(Promise.resolve(page('first')))
  await shown.refetch()
  pages.push(slow.promise, Promise.resolve(page('new')))
  void shown.refetch()
  await shown.refetch()
  slow.resolve(page('old'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(shown.getCurrentResult().data?.[0]?.sessionId, 'new')
  stop()
  client.clear()
})
