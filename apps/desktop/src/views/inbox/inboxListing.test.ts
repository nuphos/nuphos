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
const { inboxListingQuery, reloadListings } = await import('./useInbox.ts')

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

test('a question asked while a listing is loading is read once that listing lands', async () => {
  const client = createQueryClient()
  const shown = new QueryObserver(client, inboxListingQuery('team'))
  const stop = shown.subscribe(() => {})
  const loading = Promise.withResolvers<Page>()

  pages.push(Promise.resolve(page('first')))
  await shown.refetch()
  // A poll is under way when the question is asked, so it may not have it.
  pages.push(loading.promise, Promise.resolve(page('asked')))
  void shown.refetch()
  reloadListings(client)
  loading.resolve(page('first'))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(shown.getCurrentResult().data?.[0]?.sessionId, 'asked')
  stop()
  client.clear()
})
