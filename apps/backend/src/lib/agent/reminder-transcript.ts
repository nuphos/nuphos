import { notifyNudge } from '@/lib/push/notify'

import { agentMessages, appendConversationMessages } from './db'
import { bumpConversationActivity } from './db/read-state'
import { systemSender } from './message-metadata'
import { ownConversation } from './reminders'

import type { Reminder } from './reminders'
import type { ObjectId } from 'mongodb'

export const reminderMessageId = (id: ObjectId | string) => `reminder-${id.toString()}`

/** The reminder cannot be delivered and no retry will change that. */
export class PermanentFailure extends Error {}

/**
 * Writes `text` into the reminder's conversation under `messageId`, once. Writing it again after
 * a crash stores nothing new, so every retry of a step is safe.
 */
export async function writeOnce(
  reminder: Reminder,
  messageId: string,
  text: string,
  sender: string,
): Promise<void> {
  const conversation = await ownConversation(reminder.userId, reminder.sessionId, reminder.teamId)

  if (!conversation)
    throw new PermanentFailure('The conversation is gone, archived or not yours any more')
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
        parts: [{ type: 'text', text }],
        metadata: systemSender(`reminder:${reminder._id.toHexString()}`, sender),
      },
    ],
  })

  if (!saved) throw new PermanentFailure('The conversation is gone')
  await bumpConversationActivity(reminder.sessionId, reminder.userId)
}

/** The reminder's own words are only sent to its owner, never to the conversation's other readers' devices. */
export type Notify = typeof notifyNudge

export function pushOwner(notify: Notify, reminder: Reminder, title: string, body: string): void {
  notify([reminder.userId], {
    sessionId: reminder.sessionId,
    teamId: reminder.teamId,
    title,
    body,
  })
}
