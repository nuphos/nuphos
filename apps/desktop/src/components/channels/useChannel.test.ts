import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: string[] = []

mock.module('../../api.ts', {
  namedExports: {
    api: {
      agentGetConversation: async (_id: string, _team: string, opts: { tail: number }) => {
        calls.push(opts.tail === 1 ? 'probe' : 'full')

        return { messageCount: 1, title: 'c', messages: [] }
      },
      agentListChannelAgents: async () => ({ agents: [] }),
    },
  },
})

// Analytics loads only in the app.
mock.module('../../lib/chatSwitchTiming.ts', { namedExports: { useChatSwitchShown: () => {} } })

const { createQueryClient } = await import('../../lib/query/client.ts')
const { queryKeys } = await import('../../lib/query/keys.ts')
const { channelRetryMs, loadChannel, prefetchChannel, refreshChannel } =
  await import('./useChannel.ts')

test('a refresh from any pane of the channel fetches it all, even with nothing changed', async () => {
  const client = createQueryClient()
  const load = () =>
    client.query({
      queryKey: queryKeys.channel('t', 'c'),
      queryFn: () => loadChannel(client, 't', 'c'),
      staleTime: 0,
    })

  await load()
  assert.deepEqual(calls.splice(0), ['full'], 'a chat with nothing on hand reads it all at once')
  await load()
  assert.deepEqual(calls.splice(0), ['probe'], 'with a copy on hand, only the probe')
  // Another pane posted: its refresh must reach the load every pane shares.
  await refreshChannel(client, 't', 'c')
  await load()
  assert.deepEqual(calls.splice(0), ['probe', 'full'])
  client.clear()
})

test('a channel whose first load fails tries again in 8 s, then backs off', () => {
  const failed = (errorUpdateCount: number, dataUpdatedAt = 0, errorUpdatedAt = 0) =>
    channelRetryMs({ status: 'error', errorUpdateCount, dataUpdatedAt, errorUpdatedAt } as never)

  assert.deepEqual(
    [1, 2, 3, 4, 5].map((count) => failed(count)),
    [8_000, 16_000, 32_000, 60_000, 60_000],
  )
  assert.equal(failed(9, 1_000, 2_000), 8_000, 'a channel that just loaded starts short too')
  // Fixed per attempt, so a rerender between attempts never pushes the next one back.
  assert.equal(failed(9, 1_000, 31_000), 30_000)
})

test('a chat whose read failed, one left or deleted, is not prefetched again', async () => {
  const client = createQueryClient()
  const queryKey = queryKeys.channel('t', 'gone')

  await client
    .query({ queryKey, queryFn: () => Promise.reject(new Error('404')), retry: false })
    .catch(() => {})
  calls.splice(0)
  prefetchChannel(client, 't', 'gone')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, [], 'no read for a chat that already failed')
  prefetchChannel(client, 't', 'c')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls.splice(0), ['full'], 'one never read is read at once')
  client.clear()
})
