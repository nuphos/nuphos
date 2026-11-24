// #4954 against a real MongoDB: every archive and restore records who did it and through
// what, in the same write that moves `archivedAt`. Runs when TEST_MONGODB_URI is set.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { archiveIdleConversations } from '@/lib/agent/conversation-auto-archive'
import { closeDb, connectDb } from '@/lib/db'

import {
  archiveConversationAs,
  restoreArchivedConversation,
  setConversationArchived,
} from './archive'
import { leaveChats } from './bot-membership'
import { agentConversations } from './shared'

const teamId = randomUUID()
const userId = randomUUID()
const agent = randomUUID()
const id = () => randomUUID()
const seed = (sessionId: string, fields = {}) =>
  agentConversations().insertOne({
    sessionId,
    teamId,
    userId,
    title: sessionId,
    firstMessage: '',
    messageCount: 1,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...fields,
  })
const log = async (sessionId: string) =>
  ((await agentConversations().findOne({ sessionId }))?.archiveLog ?? []).map(
    ({ at, ...change }) => {
      expect(at).toBeInstanceOf(Date)

      return change
    },
  )

describe.skipIf(!process.env.TEST_MONGODB_URI)('the archive log', () => {
  beforeAll(() => connectDb())
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId })
    await closeDb()
  })

  test("an agent's archive_thread and the owner's restore, with the threads they moved", async () => {
    const [root, child, grandchild] = [id(), id(), id()]

    await seed(root)
    await seed(child, { parentSessionId: root })
    await seed(grandchild, { parentSessionId: child })
    const byAgent = { source: 'archive_thread', userId, agentSessionId: agent } as const

    await setConversationArchived(root, true, byAgent)
    await archiveConversationAs({ sessionId: root, userId }, { source: 'user', userId }, false)

    expect(await log(root)).toEqual([
      { archived: true, ...byAgent },
      { archived: false, source: 'user', userId },
    ])
    for (const nested of [child, grandchild])
      expect(await log(nested)).toEqual([
        { archived: true, ...byAgent, via: root },
        { archived: false, source: 'user', userId, via: root },
      ])
  })

  test('a Bot archived through its chat records the chat as the cause', async () => {
    const [bot, chat] = [id(), id()]

    await seed(bot, { avatar: { emoji: 'x' } })
    await seed(chat, { kind: 'channel', agentSessionIds: [bot] })
    await setConversationArchived(chat, true, { source: 'mcp', userId, agentTokenId: 'tok' })

    expect(await log(chat)).toEqual([
      { archived: true, source: 'mcp', userId, agentTokenId: 'tok' },
    ])
    expect(await log(bot)).toEqual([
      { archived: true, source: 'mcp', userId, agentTokenId: 'tok', via: chat },
    ])
  })

  test('the idle sweep, then a turn from another agent bringing it back', async () => {
    const idle = id()

    await seed(idle, { lastActiveAt: new Date('2020-01-01T00:00:00Z') })
    await archiveIdleConversations()
    await restoreArchivedConversation(idle, { source: 'turn', userId, agentSessionId: agent })

    expect(await log(idle)).toEqual([
      { archived: true, source: 'auto_archive' },
      { archived: false, source: 'turn', userId, agentSessionId: agent },
    ])
  })

  test('a Bot made a Task again archives its 1:1 chats, naming the Bot', async () => {
    const [bot, chat] = [id(), id()]

    await seed(bot)
    await seed(chat, { kind: 'channel', agentSessionIds: [bot] })
    await leaveChats(bot, userId)

    expect(await log(chat)).toEqual([{ archived: true, source: 'bot_left', userId, via: bot }])
  })

  test('the log keeps only the latest changes', async () => {
    const busy = id()

    await seed(busy)
    for (let i = 0; i < 30; i++) {
      await setConversationArchived(busy, true, { source: 'user', userId })
      await setConversationArchived(busy, false, { source: 'user', userId })
    }

    expect(await log(busy)).toHaveLength(50)
  })
})
