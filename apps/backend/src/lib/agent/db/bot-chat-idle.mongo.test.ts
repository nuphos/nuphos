// #5277 against a real MongoDB: a Bot's chat never archives itself, so a Bot left
// idle still opens. Runs when TEST_MONGODB_URI is set.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import {
  archiveIdleConversations,
  restoreStrandedBotChats,
} from '@/lib/agent/conversation-auto-archive'
import { closeDb, connectDb } from '@/lib/db'

import { agentConversations } from './shared'

const teamId = randomUUID()
const userId = randomUUID()
const id = () => randomUUID()
const idle = new Date('2020-01-01T00:00:00Z')
const seed = (sessionId: string, fields = {}) =>
  agentConversations().insertOne({
    sessionId,
    teamId,
    userId,
    title: sessionId,
    firstMessage: '',
    messageCount: 1,
    createdAt: idle,
    lastActiveAt: idle,
    ...fields,
  })
const archived = async (sessionId: string) =>
  Boolean((await agentConversations().findOne({ sessionId }))?.archivedAt)
const chatOf = (bot: string, fields = {}) => ({
  kind: 'channel',
  agentSessionIds: [bot],
  participantIds: [userId],
  ...fields,
})

describe.skipIf(!process.env.TEST_MONGODB_URI)("an idle Bot's chat", () => {
  beforeAll(() => connectDb())
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId })
    await closeDb()
  })

  test('stays open with its Bot, while an idle Task and group chat are filed away', async () => {
    const [bot, chat, task, group] = [id(), id(), id(), id()]

    await seed(bot, { avatar: { emoji: 'x' } })
    await seed(chat, chatOf(bot, { messageCount: 0 }))
    await seed(task)
    await seed(group, chatOf(bot, { group: true }))
    await archiveIdleConversations()

    expect({
      bot: await archived(bot),
      chat: await archived(chat),
      task: await archived(task),
      group: await archived(group),
    }).toEqual({ bot: false, chat: false, task: true, group: true })
  })

  test('filed away alone before the fix comes back, once', async () => {
    const [bot, older, latest, lone, loneChat, open, openChat, openOld] = [
      id(),
      id(),
      id(),
      id(),
      id(),
      id(),
      id(),
      id(),
    ]
    const at = new Date('2020-02-01T00:00:00Z')

    // A Bot left with only archived chats: they come back, once.
    await seed(bot, { avatar: { emoji: 'x' } })
    await seed(older, chatOf(bot, { archivedAt: at }))
    await seed(latest, chatOf(bot, { archivedAt: at, lastActiveAt: at }))
    // An archived Bot keeps its archived chat.
    await seed(lone, { avatar: { emoji: 'x' }, archivedAt: at })
    await seed(loneChat, chatOf(lone, { archivedAt: at }))
    // A Bot with an open chat keeps an older one archived.
    await seed(open, { avatar: { emoji: 'x' } })
    await seed(openChat, chatOf(open))
    await seed(openOld, chatOf(open, { archivedAt: at, lastActiveAt: at }))

    // Run twice, as two starts would: the second changes nothing.
    await restoreStrandedBotChats()
    await restoreStrandedBotChats()
    expect({
      older: await archived(older),
      latest: await archived(latest),
      loneChat: await archived(loneChat),
      openOld: await archived(openOld),
    }).toEqual({ older: false, latest: false, loneChat: true, openOld: true })
    for (const chat of [older, latest])
      expect((await agentConversations().findOne({ sessionId: chat }))?.archiveLog).toEqual([
        expect.objectContaining({ archived: false, source: 'bot_chat_stranded' }),
      ])
  })
})
