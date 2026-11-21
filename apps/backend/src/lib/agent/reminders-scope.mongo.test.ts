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

describe.skipIf(!process.env.TEST_MONGODB_URI)('reminder scope and cancel races', () => {
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

  test('an agent conversation acts only on itself, through both routes, and writes nothing elsewhere', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const mount = (path: string, caller: string, withTeam: boolean) => {
      const app = new Hono()

      app.use('*', async (c, next) => {
        c.set('userId' as never, userId as never)
        c.set('conversationAgent' as never, { sessionId: caller } as never)
        if (withTeam) c.set('teamId' as never, teamId.toHexString() as never)
        await next()
      })
      app.onError((error, c) =>
        error instanceof AppError
          ? c.json({ code: error.code }, error.status)
          : c.text('error', 500),
      )
      app.route(path, agentRemindersRoutes)

      return app
    }
    const post = (app: Hono, path: string, body: object) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const routes = [
      ['/agent/reminders', false],
      ['/teams/t/agent-reminders', true],
    ] as const

    for (const [path, withTeam] of routes) {
      const app = mount(path, sessionId, withTeam)
      const before = await reminders().countDocuments({ userId })
      // Aimed at another conversation of the same owner: refused, nothing stored.
      const refused = await post(app, path, {
        sessionId: otherSession,
        text: 'planted',
        dueAt: future,
      })

      expect(refused.status).toBe(403)
      expect(await reminders().countDocuments({ userId })).toBe(before)
      // Its own conversation needs no sessionId: the server takes it from the identity.
      const created = await post(app, path, { text: `own ${path}`, dueAt: future })

      expect(created.status).toBe(201)
      expect(((await created.json()) as { sessionId: string }).sessionId).toBe(sessionId)
    }
    // A reminder in the other conversation is invisible and untouchable from this one.
    const theirs = await make(minutes(970), { sessionId: otherSession })

    for (const [path, withTeam] of routes) {
      const app = mount(path, sessionId, withTeam)
      const id = theirs._id.toHexString()

      expect((await app.request(`${path}/${id}`)).status).toBe(404)
      expect((await app.request(`${path}/${id}`, { method: 'DELETE' })).status).toBe(404)
      const listed = (await (await app.request(`${path}?sessionId=${otherSession}`)).json()) as {
        reminders: { sessionId: string }[]
      }

      expect(listed.reminders.every((r) => r.sessionId === sessionId)).toBe(true)
    }
    expect((await reminders().findOne({ _id: theirs._id }))?.status).toBe('pending')
    // The owner's own session, with no conversation identity, still reaches both.
    const owner = new Hono()

    owner.use('*', async (c, next) => {
      c.set('userId' as never, userId as never)
      await next()
    })
    owner.onError((error, c) =>
      error instanceof AppError ? c.json({ code: error.code }, error.status) : c.text('error', 500),
    )
    owner.route('/agent/reminders', agentRemindersRoutes)
    expect((await owner.request(`/agent/reminders/${theirs._id.toHexString()}`)).status).toBe(200)
  })

  test('cancel and delivery settle on one state in either order', async () => {
    // Cancelled first: the sweep never claims it, nothing is saved.
    const first = await make(minutes(980))

    await cancelReminder({ userId }, first._id.toHexString())
    await deliverDueReminders(minutes(1000), notify)
    expect((await reminders().findOne({ _id: first._id }))?.status).toBe('cancelled')
    expect(await delivered(first._id)).toBe(0)
    // Claimed first: cancel is refused, delivery completes, the state matches the message.
    const second = await make(minutes(990))

    await reminders().updateOne(
      { _id: second._id },
      { $inc: { attempts: 1 }, $set: { nextAttemptAt: minutes(990) } },
    )
    await expect(cancelReminder({ userId }, second._id.toHexString())).rejects.toMatchObject({
      status: 409,
    })
    await deliverDueReminders(minutes(1000), notify)
    expect((await reminders().findOne({ _id: second._id }))?.status).toBe('delivered')
    expect(await delivered(second._id)).toBe(1)
    // An acknowledgement that arrives after a cancel changes nothing.
    expect(await ackReminder(first._id, minutes(1001), notify)).toBe(false)
    expect((await reminders().findOne({ _id: first._id }))?.status).toBe('cancelled')
  })
})
