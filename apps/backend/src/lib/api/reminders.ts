import { z } from 'zod'

import type { ApiOperation } from './registry'

export const reminderSchema = z.object({
  id: z
    .string()
    .describe('Stable ID of this occurrence. Its transcript message ID derives from it.'),
  sessionId: z.string().describe('The conversation the reminder is saved into.'),
  teamId: z.string(),
  text: z.string(),
  dueAt: z.string().describe('When it is due (ISO 8601, UTC).'),
  timeZone: z.string().describe('The zone the owner chose, used to show the due time.'),
  status: z
    .enum(['pending', 'dispatched', 'delivered', 'failed', 'unconfirmed', 'cancelled'])
    .describe(
      '`delivered` only once a plain reminder is saved in the conversation, or a task is confirmed ' +
        'done by its conversation. `dispatched`: a task was handed over and awaits that confirmation. ' +
        '`failed`: it could not be delivered or the Bot said it could not do the work. ' +
        '`unconfirmed`: a dispatched task was never confirmed; it may have run and is not retried.',
    ),
  kind: z.enum(['text', 'task']),
  dispatchedAt: z.string().optional(),
  attempts: z.number(),
  createdAt: z.string(),
  ackedAt: z.string().optional().describe('When it was saved in the conversation.'),
  failedAt: z.string().optional(),
  failureReason: z.string().optional(),
  lastError: z.string().optional().describe('The latest failed attempt of a pending reminder.'),
})

const idSchema = z.object({ reminderId: z.string() })

export const reminderApiOperations = [
  {
    operationId: 'agent.reminders.create',
    method: 'post',
    path: '/agent/reminders',
    tags: ['Reminders'],
    summary: 'Schedule a one-time reminder',
    description:
      'Saves `text` into one of your conversations at `dueAt`, once. The time is an ISO 8601 time ' +
      'with `Z` or an offset, or a local time such as `2026-11-21T09:00` read in `timeZone`. ' +
      'Delivery needs no Bot turn and no model. It is retried a bounded number of times, still ' +
      'happens after a backend restart, and writes the same message however often it is attempted. ' +
      'If it cannot be delivered you are notified once and the reminder stays `failed`. ' +
      '`dedupeKey` makes a retried create return the existing reminder. An agent conversation can only ' +
      'create, read and cancel reminders of itself.',
    auth: 'bearer',
    requestSchema: z.object({
      sessionId: z
        .string()
        .optional()
        .describe('Required for you; an agent conversation always means itself.'),
      text: z.string(),
      dueAt: z.string(),
      timeZone: z.string().optional().describe('IANA name, e.g. `Europe/Stockholm`.'),
      dedupeKey: z.string().optional(),
      kind: z
        .enum(['text', 'task'])
        .optional()
        .describe(
          '`text` (default) is written for you to read. `task` is handed to the conversation as a ' +
            'turn; its Bot must confirm it through the ack route.',
        ),
      teamId: z.string().optional(),
    }),
    responseSchema: reminderSchema,
  },
  {
    operationId: 'agent.reminders.list',
    method: 'get',
    path: '/agent/reminders',
    tags: ['Reminders'],
    summary: 'List your reminders',
    description: 'Your own reminders, newest due time first, at most 200.',
    auth: 'bearer',
    querySchema: z.object({
      teamId: z.string().optional(),
      sessionId: z.string().optional(),
      status: z.enum(['pending', 'delivered', 'failed', 'cancelled']).optional(),
    }),
    responseSchema: z.object({ reminders: z.array(reminderSchema) }),
  },
  {
    operationId: 'agent.reminders.get',
    method: 'get',
    path: '/agent/reminders/{reminderId}',
    tags: ['Reminders'],
    summary: 'Get a reminder and whether it was delivered',
    description: 'The result of a reminder stays readable after it is delivered or fails.',
    auth: 'bearer',
    pathSchema: idSchema,
    responseSchema: reminderSchema,
  },
  {
    operationId: 'agent.reminders.ack',
    method: 'post',
    path: '/agent/reminders/{reminderId}/ack',
    tags: ['Reminders'],
    summary: 'Confirm scheduled work from the conversation it was given to',
    description:
      'Only the agent conversation a `task` was dispatched to may call this, with `outcome` ' +
      '`done` after the work has actually succeeded, or `failed` with a reason. Any other caller, ' +
      'including the owner outside that conversation, gets 403. Repeating the same outcome changes ' +
      'nothing. A dispatched task is never run again: without a confirmation it becomes ' +
      '`unconfirmed` and its owner is told it may have run.',
    auth: 'bearer',
    pathSchema: idSchema,
    requestSchema: z.object({ outcome: z.enum(['done', 'failed']), reason: z.string().optional() }),
    responseSchema: reminderSchema,
  },
  {
    operationId: 'agent.reminders.cancel',
    method: 'delete',
    path: '/agent/reminders/{reminderId}',
    tags: ['Reminders'],
    summary: 'Cancel a pending reminder',
    description:
      'Only a `pending` reminder that no delivery attempt has started can be cancelled; the record stays readable.',
    auth: 'bearer',
    pathSchema: idSchema,
    responseSchema: reminderSchema,
  },
] as const satisfies readonly ApiOperation[]
