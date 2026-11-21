import { logError, logEvent } from '@/lib/observability'
import { notifyNudge } from '@/lib/push/notify'

import { agentMessages, appendConversationMessages } from './db'
import { bumpConversationActivity } from './db/read-state'
import { systemSender } from './message-metadata'
import { describeDueAt } from './reminder-time'
import { ownConversation, reminders } from './reminders'

import type { Reminder } from './reminders'
import type { ObjectId } from 'mongodb'

const MAX_ATTEMPTS = 5
const CLAIM_LEASE_MS = 2 * 60 * 1000
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
const SWEEP_INTERVAL_MS = 30_000

export const reminderMessageId = (id: ObjectId | string) => `reminder-${id.toString()}`

/** The reminder's own words are only sent to its owner, never to the conversation's other readers' devices. */
type Notify = typeof notifyNudge

function pushOwner(notify: Notify, reminder: Reminder, title: string, body: string): void {
  notify([reminder.userId], {
    sessionId: reminder.sessionId,
    teamId: reminder.teamId,
    title,
    body,
  })
}

/**
 * Acknowledges a reminder: it is saved where its owner reads it. The only writer of `ackedAt`,
 * and a no-op after the first call, so a repeated acknowledgement changes nothing.
 */
export async function ackReminder(
  id: ObjectId,
  now = new Date(),
  notify: Notify = notifyNudge,
): Promise<boolean> {
  const acked = await reminders().findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'delivered', ackedAt: now }, $unset: { lastError: '' } },
  )

  if (!acked) return false
  logEvent('info', 'agent.reminder.delivered', { reminder_id: id.toHexString() })
  pushOwner(notify, acked, 'Reminder', acked.text)

  return true
}

/** The reminder cannot be delivered and no retry will change that. */
class PermanentFailure extends Error {}

/**
 * Saves the reminder into its conversation under its stable message id, so writing it again
 * after a crash that came between this write and the acknowledgement stores nothing new.
 */
async function saveReminder(reminder: Reminder): Promise<void> {
  const conversation = await ownConversation(reminder.userId, reminder.sessionId, reminder.teamId)

  if (!conversation)
    throw new PermanentFailure('The conversation is gone, archived or not yours any more')
  const messageId = reminderMessageId(reminder._id)

  if (
    await agentMessages().findOne(
      { sessionId: reminder.sessionId, userId: reminder.userId, messageId },
      { projection: { _id: 1 } },
    )
  )
    return
  const saved = await appendConversationMessages({
    sessionId: reminder.sessionId,
    userId: reminder.userId,
    teamId: reminder.teamId,
    messages: [
      {
        id: messageId,
        role: 'user',
        parts: [{ type: 'text', text: reminder.text }],
        metadata: systemSender(`reminder:${reminder._id.toHexString()}`, 'Reminder'),
      },
    ],
  })

  if (!saved) throw new PermanentFailure('The conversation is gone')
  await bumpConversationActivity(reminder.sessionId, reminder.userId)
}

/**
 * Marks a pending reminder failed and tells its owner. The status change is the claim, so the
 * owner hears once however many replicas or sweeps reach it. No model is involved.
 */
async function failReminder(
  reminder: Reminder,
  reason: string,
  now: Date,
  notify: Notify,
): Promise<void> {
  const failed = await reminders().findOneAndUpdate(
    { _id: reminder._id, status: 'pending' },
    { $set: { status: 'failed', failedAt: now, failureReason: reason } },
  )

  if (!failed) return
  logEvent('warn', 'agent.reminder.failed', {
    reminder_id: reminder._id.toHexString(),
    team_id: reminder.teamId,
    reason,
  })
  pushOwner(
    notify,
    reminder,
    'Reminder not delivered',
    `Your reminder due ${describeDueAt(reminder.dueAt, reminder.timeZone)} was not delivered: ${reason}. "${reminder.text.slice(0, 120)}"`,
  )
}

async function attemptReminder(reminder: Reminder, now: Date, notify: Notify): Promise<void> {
  try {
    await saveReminder(reminder)
    await ackReminder(reminder._id, now, notify)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    if (error instanceof PermanentFailure || reminder.attempts >= MAX_ATTEMPTS) {
      await failReminder(
        reminder,
        error instanceof PermanentFailure ? reason : 'delivery kept failing',
        now,
        notify,
      )

      return
    }
    logError('agent.reminder.attempt_failed', error, { reminder_id: reminder._id.toHexString() })
    const backoff = BACKOFF_MS[Math.min(reminder.attempts - 1, BACKOFF_MS.length - 1)]!

    await reminders().updateOne(
      { _id: reminder._id, status: 'pending' },
      {
        $set: { lastError: reason.slice(0, 500), nextAttemptAt: new Date(now.getTime() + backoff) },
      },
    )
  }
}

/**
 * Claims each due reminder under a lease and delivers it. A claim whose process died simply
 * expires, so the next sweep, on any replica, finds the reminder due again.
 * Returns how many reminders it handled.
 */
export async function deliverDueReminders(
  now = new Date(),
  notify: Notify = notifyNudge,
): Promise<number> {
  let handled = 0

  for (;;) {
    const claimed = await reminders().findOneAndUpdate(
      { status: 'pending', nextAttemptAt: { $lte: now } },
      {
        $inc: { attempts: 1 },
        $set: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
      },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
    )

    if (!claimed) return handled
    handled += 1
    // Claims that already spent every attempt (each crash costs one) fail instead of retrying forever.
    if (claimed.attempts > MAX_ATTEMPTS)
      await failReminder(claimed, 'delivery kept failing', now, notify)
    else await attemptReminder(claimed, now, notify)
  }
}

let sweepTimer: ReturnType<typeof setInterval> | undefined
let sweeping = false

/** A plain interval, not a queue job, so it runs without Redis and a stuck queue cannot silence it. */
export function startReminderSweeper(): void {
  if (sweepTimer) return
  const sweep = () => {
    if (sweeping) return
    sweeping = true
    deliverDueReminders()
      .catch((error: unknown) => {
        logError('agent.reminder.sweep_failed', error)
      })
      .finally(() => {
        sweeping = false
      })
  }

  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
  sweepTimer.unref()
  // Overdue reminders from before a restart should not wait a whole interval.
  sweep()
}

export function stopReminderSweeper(): void {
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = undefined
}
