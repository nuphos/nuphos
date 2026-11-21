import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import { isTimeZone, parseDueAt } from './reminder-time'

export type ReminderStatus =
  'pending' | 'dispatched' | 'delivered' | 'failed' | 'unconfirmed' | 'cancelled'

/** `text` is written for its owner to read. `task` is work a Bot must carry out and confirm. */
export type ReminderKind = 'text' | 'task'

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
  /** Absent on a plain reminder. */
  kind?: ReminderKind
  /** Who scheduled a task: its owner, or the conversation itself with its own token. */
  createdBy?: 'owner' | 'conversation'
  status: ReminderStatus
  /** When a `task` was accepted by its conversation. It is never dispatched again. */
  dispatchedAt?: Date
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
  /** Set once the owner's failure notice is in their conversation. */
  noticedAt?: Date
  noticeClaimUntil?: Date
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
  /** Omit it when `callerSessionId` is set: the conversation is the caller's own. */
  sessionId?: string
  text: string
  dueAt: string
  timeZone?: string
  dedupeKey?: string
  kind?: ReminderKind
  /** The authenticated conversation when an agent is the caller. It may only act on itself. */
  callerSessionId?: string
}

/** Who is asking: the owner, narrowed to one conversation when an agent conversation is. */
export type ReminderScope = { userId: string; sessionId?: string }

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
  const sessionId = input.callerSessionId ?? input.sessionId

  if (!sessionId) throw new AppError(400, 'invalid_request', 'sessionId is required')
  if (input.sessionId && input.sessionId !== sessionId)
    throw new AppError(
      403,
      'reminder_session_out_of_scope',
      'A conversation can only set reminders in itself',
    )
  const conversation = await ownConversation(input.userId, sessionId, input.teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  const reminder: Reminder = {
    _id: new ObjectId(),
    userId: input.userId,
    teamId: conversation.teamId,
    sessionId,
    text,
    dueAt,
    timeZone: input.timeZone ?? 'UTC',
    ...(input.kind === 'task'
      ? {
          kind: 'task' as const,
          createdBy: input.callerSessionId ? ('conversation' as const) : ('owner' as const),
        }
      : {}),
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
  scope: ReminderScope,
  filter: { teamId?: string; sessionId?: string; status?: ReminderStatus },
): Promise<Reminder[]> {
  return reminders()
    .find({
      userId: scope.userId,
      ...(filter.teamId ? { teamId: filter.teamId } : {}),
      // An agent conversation sees only its own, whatever it asks for.
      ...(scope.sessionId
        ? { sessionId: scope.sessionId }
        : filter.sessionId
          ? { sessionId: filter.sessionId }
          : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
    .sort({ dueAt: -1 })
    .limit(200)
    .toArray()
}

export async function getReminder(scope: ReminderScope, id: string): Promise<Reminder> {
  const found = ObjectId.isValid(id)
    ? await reminders().findOne({
        _id: new ObjectId(id),
        userId: scope.userId,
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
      })
    : null

  if (!found) throw new AppError(404, 'not_found', 'Reminder not found')

  return found
}

/** Only a reminder no delivery attempt has claimed yet can be cancelled, so cancelling never races a write. */
export async function cancelReminder(scope: ReminderScope, id: string): Promise<Reminder> {
  const existing = await getReminder(scope, id)
  const cancelled = await reminders().findOneAndUpdate(
    { _id: existing._id, userId: scope.userId, status: 'pending', attempts: 0 },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' },
  )

  if (!cancelled)
    throw new AppError(409, 'reminder_not_cancellable', `Reminder is ${existing.status}`)

  return cancelled
}
