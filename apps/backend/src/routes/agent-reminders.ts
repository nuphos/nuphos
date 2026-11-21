import { Hono } from 'hono'

import { cancelReminder, createReminder, getReminder, listReminders } from '@/lib/agent/reminders'
import { reminderSchema } from '@/lib/api/reminders'
import { AppError } from '@/lib/errors'
import { requireAuth } from '@/middleware/auth'
import { jsonObjectBody, triggerActor } from '@/routes/agent-triggers/shared'

import type { Reminder, ReminderStatus } from '@/lib/agent/reminders'
import type { AuthVariables } from '@/middleware/auth'

const STATUSES = ['pending', 'delivered', 'failed', 'cancelled']

function present(reminder: Reminder) {
  return reminderSchema.parse({
    id: reminder._id.toHexString(),
    sessionId: reminder.sessionId,
    teamId: reminder.teamId,
    text: reminder.text,
    dueAt: reminder.dueAt.toISOString(),
    timeZone: reminder.timeZone,
    status: reminder.status,
    attempts: reminder.attempts,
    createdAt: reminder.createdAt.toISOString(),
    ackedAt: reminder.ackedAt?.toISOString(),
    failedAt: reminder.failedAt?.toISOString(),
    failureReason: reminder.failureReason,
    lastError: reminder.lastError,
  })
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

// Owner-only: a reminder is the caller's own words in the caller's own conversation.
// Mounted at /agent/reminders and, for conversation principals, /teams/:teamId/agent-reminders.
export const agentRemindersRoutes = new Hono<{ Variables: AuthVariables }>()

agentRemindersRoutes.use('*', async (c, next) => {
  if (c.get('userId')) return next()

  return requireAuth(c, next)
})

agentRemindersRoutes.post('/', async (c) => {
  const body = await jsonObjectBody(c)
  const sessionId = text(body.sessionId)
  const reminderText = text(body.text)
  const dueAt = text(body.dueAt)

  if (!sessionId || !reminderText || !dueAt)
    throw new AppError(400, 'invalid_request', 'sessionId, text and dueAt are required')
  const actor = await triggerActor(c, body.teamId)
  const { reminder, created } = await createReminder({
    userId: actor.userId,
    ...(actor.sessionId ? { callerSessionId: actor.sessionId } : {}),
    ...(actor.teamId ? { teamId: actor.teamId } : {}),
    sessionId,
    text: reminderText,
    dueAt,
    ...(text(body.timeZone) ? { timeZone: text(body.timeZone)! } : {}),
    ...(text(body.dedupeKey) ? { dedupeKey: text(body.dedupeKey)! } : {}),
  })

  return c.json(present(reminder), created ? 201 : 200)
})

agentRemindersRoutes.get('/', async (c) => {
  const actor = await triggerActor(c, c.req.query('teamId'))
  const status = c.req.query('status')

  if (status && !STATUSES.includes(status))
    throw new AppError(400, 'invalid_request', `status must be one of ${STATUSES.join(', ')}`)
  const found = await listReminders(actor.userId, {
    ...(actor.teamId ? { teamId: actor.teamId } : {}),
    ...(c.req.query('sessionId') ? { sessionId: c.req.query('sessionId')! } : {}),
    ...(status ? { status: status as ReminderStatus } : {}),
  })

  return c.json({ reminders: found.map(present) })
})

agentRemindersRoutes.get('/:reminderId', async (c) => {
  const actor = await triggerActor(c, c.req.query('teamId'))

  return c.json(present(await getReminder(actor.userId, c.req.param('reminderId'))))
})

agentRemindersRoutes.delete('/:reminderId', async (c) => {
  const actor = await triggerActor(c, c.req.query('teamId'))

  return c.json(present(await cancelReminder(actor.userId, c.req.param('reminderId'))))
})
