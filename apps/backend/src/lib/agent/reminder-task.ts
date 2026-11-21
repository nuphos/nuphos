import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { systemSender } from './message-metadata'
import { describeDueAt } from './reminder-time'
import { PermanentFailure } from './reminder-transcript'
import { getReminder, ownConversation, reminders } from './reminders'

import type { Reminder, ReminderScope } from './reminders'

/** How long a dispatched task may stay unconfirmed before the owner is told it might have run. */
export const CONFIRM_WAIT_MS = 15 * 60 * 1000

export const taskMessageId = (reminder: Reminder) => `reminder-task-${reminder._id.toHexString()}`
export const SCHEDULED_WORK_SENDER = 'scheduled-work:'

function taskPrompt(reminder: Reminder): string {
  const id = reminder._id.toHexString()
  const ack = `POST /teams/${reminder.teamId}/agent-reminders/${id}/ack`

  return (
    `Scheduled work ${id}, due ${describeDueAt(reminder.dueAt, reminder.timeZone)}:\n\n${reminder.text}\n\n` +
    `Once it has actually succeeded, confirm it with ${ack} and {"outcome":"done"}. ` +
    `If you cannot do it, send {"outcome":"failed","reason":"..."}. Never confirm before it has succeeded.`
  )
}

/**
 * Hands a due task to its conversation as an ordinary turn, once. The message id is stable, so a
 * redelivery of a turn the conversation already accepted starts nothing new, and a crash between
 * the acceptance and recording it only repeats this call. Dispatched is not done: only the
 * conversation's own confirmation completes it.
 */
export async function dispatchTask(reminder: Reminder, now: Date): Promise<void> {
  const conversation = await ownConversation(reminder.userId, reminder.sessionId, reminder.teamId)

  if (!conversation)
    throw new PermanentFailure('The conversation is gone, archived or not yours any more')
  const { startConversationTurn } = await import('./conversation-turn')

  const { run } = await startConversationTurn(
    {
      userId: reminder.userId,
      teamId: reminder.teamId,
      targetSessionId: reminder.sessionId,
      messageId: taskMessageId(reminder),
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    conversation,
    taskPrompt(reminder),
    'agent.resource',
    systemSender(
      `${SCHEDULED_WORK_SENDER}${reminder._id.toHexString()}`,
      'Scheduled work',
      `/teams/${reminder.teamId}/agent-reminders/${reminder._id.toHexString()}`,
    ),
  )

  // A turn that then fails (no quota, no runtime) is not a failed dispatch: the work may have
  // started, so only a confirmation or the wait settles it.
  run.catch((error: unknown) => {
    logError('agent.reminder.turn_failed', error, { reminder_id: reminder._id.toHexString() })
  })
  await reminders().updateOne(
    { _id: reminder._id, status: 'pending' },
    { $set: { status: 'dispatched', dispatchedAt: now }, $unset: { lastError: '' } },
  )
  logEvent('info', 'agent.reminder.dispatched', { reminder_id: reminder._id.toHexString() })
}

/** A dispatched task nobody confirmed in time: it may have run, so it is reported, never retried. */
export async function markUnconfirmedTasks(now: Date): Promise<void> {
  for (;;) {
    const overdue = await reminders().findOneAndUpdate(
      { status: 'dispatched', dispatchedAt: { $lte: new Date(now.getTime() - CONFIRM_WAIT_MS) } },
      {
        $set: {
          status: 'unconfirmed',
          failedAt: now,
          failureReason: 'The Bot did not confirm the work',
        },
      },
    )

    if (!overdue) return
    logEvent('warn', 'agent.reminder.unconfirmed', { reminder_id: overdue._id.toHexString() })
  }
}

export type TaskOutcome = 'done' | 'failed'

/**
 * The conversation the task was dispatched to settles it. Nobody else may: not the owner's
 * session, not another conversation. Repeating the same outcome changes nothing, a conflicting
 * one is refused, and a late `done` replaces `unconfirmed` because the work did finish.
 */
export async function confirmTask(
  scope: ReminderScope,
  id: string,
  outcome: TaskOutcome,
  reason: string | undefined,
  now = new Date(),
): Promise<Reminder> {
  const existing = await getReminder(scope, id)

  if (!scope.sessionId || existing.sessionId !== scope.sessionId)
    throw new AppError(
      403,
      'reminder_ack_not_allowed',
      'Only the conversation it was given to can confirm it',
    )
  if (existing.kind !== 'task')
    throw new AppError(409, 'reminder_not_a_task', 'A plain reminder is confirmed by Nuphos itself')
  const settled = await reminders().findOneAndUpdate(
    { _id: existing._id, status: { $in: ['dispatched', 'unconfirmed'] } },
    outcome === 'done'
      ? { $set: { status: 'delivered', ackedAt: now }, $unset: { failureReason: '' } }
      : {
          $set: {
            status: 'failed',
            failedAt: now,
            failureReason: (reason?.trim() || 'The Bot reported it could not do the work').slice(
              0,
              500,
            ),
          },
        },
    { returnDocument: 'after' },
  )

  if (settled) return settled
  const wanted = outcome === 'done' ? 'delivered' : 'failed'

  if (existing.status === wanted) return existing
  throw new AppError(409, 'reminder_not_confirmable', `The work is ${existing.status}`)
}
