import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

// #3310: the Inbox opened a Bot's own session, as a Task, and left the sidebar on the Inbox.
mock.module('../../components/channels/botChannel.ts', {
  namedExports: {
    openBotChannel: (_teamId: string, botId: string, open: (key: string) => void) =>
      open(`agent-session:chat-of-${botId}`),
  },
})

const { openListed } = await import('./openListed.ts')
const { setSidebarMode, sidebarMode } = await import('../../components/sidebar/sidebarModeStore.ts')

const opened = (listed: Parameters<typeof openListed>[1]) => {
  const ids: string[] = []

  setSidebarMode('team', 2)
  openListed('team', listed, (id) => ids.push(id))

  return { ids, page: sidebarMode('team', 2) }
}

test('a Bot opens by its chat, with Bots in the sidebar', () => {
  assert.deepEqual(opened({ sessionId: 'bot', avatar: 'fox' }), { ids: ['chat-of-bot'], page: 0 })
})

test('a Task opens as itself, with Tasks in the sidebar', () => {
  assert.deepEqual(opened({ sessionId: 'task' }), { ids: ['task'], page: 1 })
})

test('a chat opens as itself, with Bots in the sidebar', () => {
  assert.deepEqual(opened({ sessionId: 'chat', kind: 'channel' }), { ids: ['chat'], page: 0 })
})
