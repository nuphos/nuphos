// One-time reminders against a real MongoDB: the claim lease, the idempotent write, the single
// acknowledgement and the single failure notice are query semantics a fake collection would only
// echo. Runs when TEST_MONGODB_URI is set.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { teams } from '@/lib/identity/shared'
import { agentRemindersRoutes } from '@/routes/agent-reminders'

import { agentMessages } from './db'
import { agentConversations } from './db/shared'
import { ackReminder, deliverDueReminders } from './reminder-delivery'
import { reminderNoticeId } from './reminder-notice'
import { reminderMessageId } from './reminder-transcript'
import { cancelReminder, createReminder, reminders, setupReminderIndexes } from './reminders'

const userId = new ObjectId().toHexString()
const teamId = new ObjectId()
const sessionId = `reminder-test-${teamId.toHexString()}`
const otherSession = `${sessionId}-other`
const T0 = new Date('2026-11-21T08:00:00.000Z')
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)

const notices: { userIds: string[]; title: string; body: string }[] = []
const notify = (userIds: string[], push: { title: string; body: string }) => {
  notices.push({ userIds, title: push.title, body: push.body })
}
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

describe.skipIf(!process.env.TEST_MONGODB_URI)('one-time reminders', () => {
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

  test('is not delivered before it is due, then once at its time, then never again', async () => {
    const reminder = await make(minutes(10))

    expect(await deliverDueReminders(minutes(9), notify)).toBe(0)
    expect(await delivered(reminder._id)).toBe(0)
    expect(await deliverDueReminders(minutes(10), notify)).toBe(1)
    expect(await delivered(reminder._id)).toBe(1)
    expect((await reminders().findOne({ _id: reminder._id }))?.status).toBe('delivered')
    expect(await deliverDueReminders(minutes(60), notify)).toBe(0)
    expect(await delivered(reminder._id)).toBe(1)
  })

  test('an overdue reminder is picked up by the first sweep after a restart', async () => {
    const reminder = await make(minutes(100))

    expect(await deliverDueReminders(minutes(5000), notify)).toBe(1)
    expect(await delivered(reminder._id)).toBe(1)
  })

  test('a crash between the write and the acknowledgement shows one reminder', async () => {
    const reminder = await make(minutes(200))

    // The attempt wrote the message, then died: claimed, message saved, never acknowledged.
    await reminders().updateOne(
      { _id: reminder._id },
      { $inc: { attempts: 1 }, $set: { nextAttemptAt: minutes(202) } },
    )
    await agentMessages().insertOne({
      sessionId,
      userId,
      messageId: reminderMessageId(reminder._id),
      role: 'user',
      parts: [{ type: 'text', text: 'stand up' }],
    } as never)
    expect(await deliverDueReminders(minutes(201), notify)).toBe(0)
    expect(await deliverDueReminders(minutes(203), notify)).toBe(1)
    expect(await delivered(reminder._id)).toBe(1)
    expect((await reminders().findOne({ _id: reminder._id }))?.status).toBe('delivered')
  })

  test('acknowledging again changes nothing and notifies nothing', async () => {
    const reminder = await make(minutes(300))
    const before = notices.length

    await deliverDueReminders(minutes(300), notify)
    const acked = (await reminders().findOne({ _id: reminder._id }))?.ackedAt

    expect(notices).toHaveLength(before + 1)
    expect(await ackReminder(reminder._id, minutes(400), notify)).toBe(false)
    expect((await reminders().findOne({ _id: reminder._id }))?.ackedAt).toEqual(acked)
    expect(notices).toHaveLength(before + 1)
  })

  test('a conversation that is gone fails the reminder once and tells only its owner', async () => {
    const reminder = await make(minutes(400))
    const before = notices.length

    await agentConversations().updateOne({ sessionId }, { $set: { archivedAt: new Date() } })
    await deliverDueReminders(minutes(400), notify)
    await deliverDueReminders(minutes(9999), notify)
    await agentConversations().updateOne({ sessionId }, { $unset: { archivedAt: '' } })

    const saved = await reminders().findOne({ _id: reminder._id })

    expect(saved?.status).toBe('failed')
    expect(saved?.failureReason).toContain('conversation')
    expect(await delivered(reminder._id)).toBe(0)
    expect(notices.slice(before)).toHaveLength(1)
    expect(notices[before]?.userIds).toEqual([userId])
    expect(notices[before]?.title).toBe('Reminder not delivered')
  })

  test('a failed reminder leaves one notice in its conversation, with push off, even across a crash', async () => {
    const quiet = () => {
      throw new Error('push is off')
    }
    const reminder = await make(minutes(450))

    await reminders().updateOne(
      { _id: reminder._id },
      { $set: { attempts: 5, nextAttemptAt: minutes(450) } },
    )
    // The first sweep fails the reminder; a push that throws must not lose or repeat the notice.
    await deliverDueReminders(minutes(451), quiet).catch(() => undefined)
    const noticeId = reminderNoticeId(reminder)
    const notices = () => agentMessages().countDocuments({ sessionId, messageId: noticeId })

    expect((await reminders().findOne({ _id: reminder._id }))?.status).toBe('failed')
    expect(await notices()).toBe(1)
    // A crash between the failure and the notice: a failed record with none written.
    const lost = await make(minutes(452))

    await reminders().updateOne(
      { _id: lost._id },
      { $set: { status: 'failed', failureReason: 'delivery kept failing' } },
    )
    await deliverDueReminders(minutes(460), notify)
    await deliverDueReminders(minutes(9000), notify)
    expect(
      await agentMessages().countDocuments({ sessionId, messageId: reminderNoticeId(lost) }),
    ).toBe(1)
    expect((await reminders().findOne({ _id: lost._id }))?.noticedAt).toBeDefined()
  })

  test('a reminder whose attempts keep crashing fails after the bounded number of them', async () => {
    const reminder = await make(minutes(500))
    const before = notices.length

    await reminders().updateOne(
      { _id: reminder._id },
      { $set: { attempts: 5, nextAttemptAt: minutes(500) } },
    )
    await deliverDueReminders(minutes(501), notify)

    expect((await reminders().findOne({ _id: reminder._id }))?.status).toBe('failed')
    expect(await delivered(reminder._id)).toBe(0)
    expect(notices).toHaveLength(before + 1)
  })

  test('a conversation cannot leave a reminder in another one; a claimed reminder cannot be cancelled', async () => {
    const input = {
      userId,
      teamId: teamId.toHexString(),
      sessionId,
      text: 'planted',
      dueAt: minutes(950).toISOString(),
      callerSessionId: 'another-conversation',
    }

    await expect(createReminder(input, minutes(0))).rejects.toMatchObject({ status: 403 })
    const claimed = await make(minutes(960))

    await reminders().updateOne({ _id: claimed._id }, { $inc: { attempts: 1 } })
    await expect(cancelReminder({ userId }, claimed._id.toHexString())).rejects.toMatchObject({
      status: 409,
    })
    expect(
      (await createReminder({ ...input, callerSessionId: sessionId }, minutes(0))).created,
    ).toBe(true)
  })

  test('a cancelled reminder is never delivered; a repeated create returns the same one', async () => {
    const reminder = await make(minutes(600))

    await cancelReminder({ userId }, reminder._id.toHexString())
    expect(await deliverDueReminders(minutes(700), notify)).toBe(0)
    expect(await delivered(reminder._id)).toBe(0)
    const input = {
      userId,
      teamId: teamId.toHexString(),
      sessionId,
      text: 'once',
      dueAt: minutes(900).toISOString(),
      dedupeKey: 'same-request',
    }
    const first = await createReminder(input, minutes(0))
    const second = await createReminder(input, minutes(1))

    expect(second.created).toBe(false)
    expect(second.reminder._id.equals(first.reminder._id)).toBe(true)
  })
})
