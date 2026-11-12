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

const { createQueryClient } = await import('../../lib/query/client.ts')
const { queryKeys } = await import('../../lib/query/keys.ts')
const { loadChannel, refreshChannel } = await import('./useChannel.ts')

test('a refresh from any pane of the channel fetches it all, even with nothing changed', async () => {
  const client = createQueryClient()
  const load = () =>
    client.query({
      queryKey: queryKeys.channel('t', 'c'),
      queryFn: () => loadChannel(client, 't', 'c'),
      staleTime: 0,
    })

  await load()
  await load()
  assert.deepEqual(calls.splice(0), ['probe', 'full', 'probe'])
  // Another pane posted: its refresh must reach the load every pane shares.
  await refreshChannel(client, 't', 'c')
  await load()
  assert.deepEqual(calls.splice(0), ['probe', 'full'])
  client.clear()
})
