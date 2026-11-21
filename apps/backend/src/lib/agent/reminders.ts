import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import { isTimeZone, parseDueAt } from './reminder-time'

export type ReminderStatus = 'pending' | 'delivered' | 'failed' | 'cancelled'

/**
 * One occurrence of a one-time reminder. `_id` is its stable identity: the transcript message
 * id derives from it, so every attempt writes the same message.
 */
export type Reminder = {
  _id: ObjectId
  userId: string
  teamId: string
  /** The conversation the reminder is saved into. */
  sessionId: string
  text: string
  dueAt: Date
  timeZone: string
  status: ReminderStatus
  /** Attempts claimed so far, including one a crash cut short. */
  attempts: number
  /** Due time, then the end of a claim or backoff: the earliest the next attempt may start. */
  nextAttemptAt: Date
  /** Idempotency key of the create call, so a retried create does not make a second reminder. */
  dedupeKey?: string
  lastError?: string
  /** Set once the reminder is saved where its owner reads it. Nothing else sets it. */
  ackedAt?: Date
  failedAt?: Date
  failureReason?: string
  createdAt: Date
}

export const reminders = () => db().collection<Reminder>('agent_reminders')

export async function setupReminderIndexes(): Promise<void> {
  await reminders().createIndex(
    { status: 1, nextAttemptAt: 1 },
    { name: 'reminder_status_next_attempt' },
  )
  await reminders().createIndex({ userId: 1, createdAt: -1 }, { name: 'reminder_user_created' })
  await reminders().createIndex(
    { userId: 1, dedupeKey: 1 },
    {
      name: 'reminder_user_dedupe',
      unique: true,
      partialFilterExpression: { dedupeKey: { $type: 'string' } },
    },
  )
}

const MAX_TEXT = 2000

type CreateReminder = {
  userId: string
  teamId?: string
  sessionId: string
  text: string
  dueAt: string
  timeZone?: string
  dedupeKey?: string
}

/** The conversation must be the caller's own, in a team they belong to. */
export async function ownConversation(userId: string, sessionId: string, teamId?: string) {
  const conversation = await getConversationBySessionId(sessionId)

  if (
    !conversation ||
    conversation.userId !== userId ||
    !conversation.teamId ||
    (teamId && conversation.teamId !== teamId) ||
    conversation.archivedAt ||
    !(await getTeamMembership(userId, conversation.teamId))
  )
    return null

  return { ...conversation, teamId: conversation.teamId }
}

export async function createReminder(
  input: CreateReminder,
  now = new Date(),
): Promise<{ reminder: Reminder; created: boolean }> {
  const text = input.text.trim()

  if (!text || text.length > MAX_TEXT)
    throw new AppError(400, 'invalid_request', `text must be 1-${String(MAX_TEXT)} characters`)
  if (input.timeZone && !isTimeZone(input.timeZone))
    throw new AppError(400, 'invalid_request', 'timeZone must be an IANA time zone name')
  const dueAt = parseDueAt(input.dueAt, input.timeZone)

  if (!dueAt)
    throw new AppError(
      400,
      'invalid_request',
      'dueAt must be an ISO time with Z or an offset, or a local time (2026-11-21T09:00) with timeZone',
    )
  if (dueAt.getTime() <= now.getTime())
    throw new AppError(400, 'invalid_request', 'dueAt must be in the future')
  const conversation = await ownConversation(input.userId, input.sessionId, input.teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  const reminder: Reminder = {
    _id: new ObjectId(),
    userId: input.userId,
    teamId: conversation.teamId,
    sessionId: input.sessionId,
    text,
    dueAt,
    timeZone: input.timeZone ?? 'UTC',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: dueAt,
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    createdAt: now,
  }

  try {
    await reminders().insertOne(reminder)

    return { reminder, created: true }
  } catch (error) {
    const existing = input.dedupeKey
      ? await reminders().findOne({ userId: input.userId, dedupeKey: input.dedupeKey })
      : null

    if (!existing) throw error

    return { reminder: existing, created: false }
  }
}

export async function listReminders(
  userId: string,
  filter: { teamId?: string; sessionId?: string; status?: ReminderStatus },
): Promise<Reminder[]> {
  return reminders()
    .find({
      userId,
      ...(filter.teamId ? { teamId: filter.teamId } : {}),
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
    .sort({ dueAt: -1 })
    .limit(200)
    .toArray()
}

export async function getReminder(userId: string, id: string): Promise<Reminder> {
  const found = ObjectId.isValid(id)
    ? await reminders().findOne({ _id: new ObjectId(id), userId })
    : null

  if (!found) throw new AppError(404, 'not_found', 'Reminder not found')

  return found
}

/** Only a reminder that has not yet been delivered or failed can be cancelled. */
export async function cancelReminder(userId: string, id: string): Promise<Reminder> {
  const existing = await getReminder(userId, id)
  const cancelled = await reminders().findOneAndUpdate(
    { _id: existing._id, userId, status: 'pending' },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' },
  )

  if (!cancelled) throw new AppError(409, 'reminder_not_pending', `Reminder is ${existing.status}`)

  return cancelled
}
