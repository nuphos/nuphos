import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import { upsertConversationShell } from './conversations'
import { botChange, claimBotAvatar, setConversationAvatar, updateBotSelf } from './maintenance'

import type * as dbActual from '@/lib/db'

type Update = { $set?: object; $unset?: object; $push?: object; $setOnInsert?: object }

// Each write as it reaches Mongo: the face and its record must be one update.
let updates: Update[] = []
const botId = new ObjectId()
// The Bots whose stored photos were pruned.
let pruned: string[] = []

useDb({
  db: (() => ({
    collection: () => ({
      updateOne: (_filter: object, update: Update) => {
        updates.push(update)

        return Promise.resolve({ matchedCount: 1, modifiedCount: 1, upsertedCount: 1 })
      },
      findOneAndUpdate: (_filter: object, update: Update) => {
        updates.push(update)

        return Promise.resolve({ _id: botId })
      },
      // Pruning: the Bot's current face is not a stored photo here.
      findOne: () => Promise.resolve(null),
      deleteMany: (filter: { userId: ObjectId }) => {
        pruned.push(filter.userId.toHexString())

        return Promise.resolve()
      },
    }),
  })) as unknown as typeof dbActual.db,
})

const recorded = (event: object) => ({
  timelineEvents: {
    $each: [{ kind: 'bot_changed', at: expect.any(Date), ...event }],
    $slice: -200,
  },
})

beforeEach(() => {
  updates = []
  pruned = []
})

test('"Make this a Bot" records who did it with the face', async () => {
  await claimBotAvatar('s1', '07-ada', 'alice')

  expect(updates).toEqual([
    {
      $set: { avatar: '07-ada' },
      $push: recorded({ actorId: 'alice', via: 'make_bot', avatar: '07-ada' }),
    },
  ])
})

test('changing a face and taking it away are both recorded', async () => {
  await setConversationAvatar('s1', '05-rembrandt', 'alice')
  await setConversationAvatar('s1', null, 'alice')

  expect(updates).toEqual([
    {
      $set: { avatar: '05-rembrandt' },
      $push: recorded({ actorId: 'alice', via: 'avatar_route', avatar: '05-rembrandt' }),
    },
    // No avatar on the record: the Bot is a Task again.
    {
      $unset: { avatar: '', avatarBackground: '' },
      $push: recorded({ actorId: 'alice', via: 'avatar_route' }),
    },
  ])
})

test('a background is stored with the face; none and taking the face away clear it', async () => {
  await setConversationAvatar('s1', '05-rembrandt', 'alice', 'sky')
  await setConversationAvatar('s1', '05-rembrandt', 'alice', 'none')
  await setConversationAvatar('s1', null, 'alice')

  const change = recorded({ actorId: 'alice', via: 'avatar_route', avatar: '05-rembrandt' })

  expect(updates).toEqual([
    { $set: { avatar: '05-rembrandt', avatarBackground: 'sky' }, $push: change },
    { $set: { avatar: '05-rembrandt' }, $unset: { avatarBackground: '' }, $push: change },
    {
      $unset: { avatar: '', avatarBackground: '' },
      $push: recorded({ actorId: 'alice', via: 'avatar_route' }),
    },
  ])
})

test('a Bot editing itself is recorded only when its face changes', async () => {
  await updateBotSelf('s1', 'alice', 't', { instructions: 'Watch releases.' })
  await updateBotSelf('s1', 'alice', 't', { avatar: '07-ada' })
  await updateBotSelf('s1', 'alice', 't', { avatar: 'stored-file' }, 'bot_import')

  expect(updates).toEqual([
    { $set: { instructions: 'Watch releases.' } },
    {
      $set: { avatar: '07-ada' },
      $push: recorded({ actorId: 'alice', via: 'update_self', avatar: '07-ada' }),
    },
    {
      $set: { avatar: 'stored-file' },
      $push: recorded({ actorId: 'alice', via: 'bot_import', avatar: 'stored-file' }),
    },
  ])
  // Each new face drops the photos the Bot wore before; other edits keep them.
  expect(pruned).toEqual([botId.toHexString(), botId.toHexString()])
})

test('a conversation created as a Bot starts with the record', async () => {
  const change = botChange({ actorId: 'alice', via: 'create_bot', sessionId: 'caller' }, '07-ada')

  await upsertConversationShell({
    sessionId: 's1',
    userId: 'alice',
    teamId: 't',
    title: 'Release Helper',
    firstMessage: '',
    bot: { avatar: '07-ada', change },
  })

  expect(updates[0]?.$setOnInsert).toMatchObject({ avatar: '07-ada', timelineEvents: [change] })
  expect(change).toEqual({
    kind: 'bot_changed',
    at: expect.any(Date),
    actorId: 'alice',
    via: 'create_bot',
    sessionId: 'caller',
    avatar: '07-ada',
  })
})
