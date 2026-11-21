// One-time reminders against a real MongoDB: the claim lease, the idempotent write, the single
// acknowledgement and the single failure notice are query semantics a fake collection would only
// echo. Runs when TEST_MONGODB_URI is set.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { teams } from '@/lib/identity/shared'

import { agentMessages } from './db'
import { agentConversations } from './db/shared'
import { deliverDueReminders } from './reminder-delivery'
import { CONFIRM_WAIT_MS, confirmTask, taskPrompt } from './reminder-task'
import { reminderNoticeId } from './reminder-notice'
import { reminderMessageId } from './reminder-transcript'
import { cancelReminder, createReminder, reminders, setupReminderIndexes } from './reminders'

const userId = new ObjectId().toHexString()
const teamId = new ObjectId()
const sessionId = `reminder-test-${teamId.toHexString()}`
const otherSession = `${sessionId}-other`
const T0 = new Date('2026-11-21T08:00:00.000Z')
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)

const notify = () => undefined
const delivered = (id: ObjectId) =>
  agentMessages().countDocuments({ sessionId, messageId: reminderMessageId(id) })
const make = (dueAt: Date, extra: Record<string, string> = {}) =>
  createReminder(
    {
      userId,
      teamId: teamId.toHexString(),
      sessionId,
      text: 'stand up',
      dueAt: dueAt.toISOString(),
      ...extra,
    },
    new Date(dueAt.getTime() - 3_600_000),
  ).then(({ reminder }) => reminder)

describe.skipIf(!process.env.TEST_MONGODB_URI)(
  'scheduled work the conversation must confirm',
  () => {
    beforeAll(async () => {
      await connectDb()
      await setupReminderIndexes()
      await teams().insertOne({
        _id: teamId,
        name: 'reminder-test',
        avatarUrl: '',
        ownerID: new ObjectId(userId),
        contactEmails: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        members: [{ userId: new ObjectId(userId), role: 'ADMIN', joinedAt: new Date() }],
      } as never)
      await agentConversations().insertOne({
        sessionId,
        teamId: teamId.toHexString(),
        userId,
        title: 'reminder-test',
        firstMessage: 'hi',
        messageCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      } as never)
      await agentConversations().insertOne({
        sessionId: otherSession,
        teamId: teamId.toHexString(),
        userId,
        title: 'other',
        firstMessage: 'hi',
        messageCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      } as never)
    })
    afterAll(async () => {
      await reminders().deleteMany({ userId })
      await agentMessages().deleteMany({ sessionId: { $in: [sessionId, otherSession] } })
      await agentConversations().deleteMany({ sessionId: { $in: [sessionId, otherSession] } })
      await teams().deleteOne({ _id: teamId })
      await closeDb()
    })

    const task = (dueAt: Date) => make(dueAt, { kind: 'task' })
    const dispatched = async (at: Date) => {
      const reminder = await task(minutes(1))

      await reminders().updateOne(
        { _id: reminder._id },
        { $set: { status: 'dispatched', dispatchedAt: at, attempts: 1 } },
      )

      return reminder._id.toHexString()
    }
    const own = { userId, sessionId }
    const state = async (id: string) => (await reminders().findOne({ _id: new ObjectId(id) }))!

    test('only the conversation it was given to confirms; repeating is a no-op, conflicting is refused', async () => {
      const id = await dispatched(minutes(2))

      await expect(confirmTask({ userId }, id, 'done', undefined)).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        confirmTask({ userId, sessionId: otherSession }, id, 'done', undefined),
      ).rejects.toMatchObject({ status: 404 })
      expect((await state(id)).status).toBe('dispatched')
      const first = await confirmTask(own, id, 'done', undefined, minutes(3))
      const again = await confirmTask(own, id, 'done', undefined, minutes(9))

      expect(first.status).toBe('delivered')
      expect(again.ackedAt).toEqual(first.ackedAt)
      await expect(confirmTask(own, id, 'failed', 'too late')).rejects.toMatchObject({
        status: 409,
      })
      expect((await state(id)).status).toBe('delivered')
    })

    test('a plain reminder is not confirmed by a Bot, and a task not yet dispatched cannot be', async () => {
      const plain = await make(minutes(5))
      const waiting = await make(new Date('2099-01-01T00:00:00.000Z'), { kind: 'task' })

      await expect(
        confirmTask(own, plain._id.toHexString(), 'done', undefined),
      ).rejects.toMatchObject({ status: 409 })
      await expect(
        confirmTask(own, waiting._id.toHexString(), 'done', undefined),
      ).rejects.toMatchObject({ status: 409 })
      expect((await state(waiting._id.toHexString())).status).toBe('pending')
    })

    test('a Bot that says it failed fails the task and the owner finds one notice', async () => {
      const id = await dispatched(minutes(10))
      const settled = await confirmTask(own, id, 'failed', 'the disk was full', minutes(11))

      expect(settled.failureReason).toBe('the disk was full')
      await deliverDueReminders(minutes(12), notify)
      await deliverDueReminders(minutes(5000), notify)
      expect(
        await agentMessages().countDocuments({ sessionId, messageId: `reminder-failed-${id}` }),
      ).toBe(1)
    })

    test('a dispatched task nobody confirmed becomes unconfirmed, is never run again, and a late done corrects it', async () => {
      const id = await dispatched(minutes(20))

      await deliverDueReminders(new Date(minutes(20).getTime() + CONFIRM_WAIT_MS - 1000), notify)
      expect((await state(id)).status).toBe('dispatched')
      await deliverDueReminders(new Date(minutes(20).getTime() + CONFIRM_WAIT_MS + 1000), notify)
      await deliverDueReminders(minutes(9000), notify)
      const saved = await state(id)

      expect(saved.status).toBe('unconfirmed')
      expect(saved.attempts).toBe(1)
      expect(
        await agentMessages().countDocuments({ sessionId, messageId: `reminder-failed-${id}` }),
      ).toBe(1)
      expect((await confirmTask(own, id, 'done', undefined, minutes(9001))).status).toBe(
        'delivered',
      )
    })

    test('a task records who scheduled it, and the delivered text says so', async () => {
      const input = {
        userId,
        teamId: teamId.toHexString(),
        text: 'Rotate the key',
        dueAt: minutes(1500).toISOString(),
        kind: 'task' as const,
      }
      const byOwner = (await createReminder({ ...input, sessionId }, minutes(0))).reminder
      const byBot = (await createReminder({ ...input, callerSessionId: sessionId }, minutes(0)))
        .reminder

      expect(byOwner.createdBy).toBe('owner')
      expect(byBot.createdBy).toBe('conversation')
      expect(taskPrompt(byOwner)).toContain("scheduled by this conversation's owner")
      expect(taskPrompt(byBot)).toContain(
        'scheduled by this conversation itself, not typed by its owner',
      )
    })
  },
)
