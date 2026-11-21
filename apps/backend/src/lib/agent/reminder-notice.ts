import { logError, logEvent } from '@/lib/observability'

import { describeDueAt } from './reminder-time'
import { PermanentFailure, pushOwner, writeOnce } from './reminder-transcript'
import { reminders } from './reminders'

import type { Notify } from './reminder-transcript'
import type { Reminder } from './reminders'

const NOTICE_LEASE_MS = 2 * 60 * 1000

export const reminderNoticeId = (reminder: Reminder) =>
  `reminder-failed-${reminder._id.toHexString()}`

const noticeText = (reminder: Reminder) =>
  `A reminder due ${describeDueAt(reminder.dueAt, reminder.timeZone)} could not be delivered: ` +
  `${reminder.failureReason ?? 'delivery failed'}.\n\n${reminder.text}`

/**
 * Tells the owner of each failed reminder, from the record rather than from the moment it failed:
 * the notice is written into the conversation under a stable id, so it is there when the owner
 * next opens it with push off or the device offline, and a crash between the failure and the
 * notice only delays it. The push follows once, by whoever records the notice. No model is involved.
 */
export async function noticeFailedReminders(now: Date, notify: Notify): Promise<void> {
  for (;;) {
    const claimed = await reminders().findOneAndUpdate(
      {
        status: 'failed',
        noticedAt: { $exists: false },
        $or: [{ noticeClaimUntil: { $exists: false } }, { noticeClaimUntil: { $lte: now } }],
      },
      { $set: { noticeClaimUntil: new Date(now.getTime() + NOTICE_LEASE_MS) } },
      { returnDocument: 'after' },
    )

    if (!claimed) return
    try {
      await writeOnce(claimed, reminderNoticeId(claimed), noticeText(claimed), 'Reminder failed')
    } catch (error) {
      // A conversation that is gone cannot hold a notice; only the push remains. Anything else is retried.
      if (!(error instanceof PermanentFailure)) {
        logError('agent.reminder.notice_failed', error, { reminder_id: claimed._id.toHexString() })
        continue
      }
    }
    const recorded = await reminders().findOneAndUpdate(
      { _id: claimed._id, noticedAt: { $exists: false } },
      { $set: { noticedAt: now } },
    )

    if (!recorded) continue
    logEvent('warn', 'agent.reminder.noticed', {
      reminder_id: claimed._id.toHexString(),
      team_id: claimed.teamId,
      reason: claimed.failureReason,
    })
    pushOwner(notify, claimed, 'Reminder not delivered', noticeText(claimed).slice(0, 240))
  }
}
