import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildClosedConversationNotification,
  CLOSED_TRANSCRIPT_RETRY_DELAYS_MS,
} from './closedConversationNotification.ts'

import type { StopNotificationMessage } from '../../../lib/agentStopNotification.ts'

const user = (text: string): StopNotificationMessage => ({
  role: 'user',
  parts: [{ type: 'text', text }],
})
const assistant = (text: string): StopNotificationMessage => ({
  role: 'assistant',
  parts: [
    { type: 'tool', toolName: 'bash', state: 'output-available' },
    { type: 'text', text },
  ],
})
const noWait = () => Promise.resolve()

test('a closed conversation notifies with the answer from the persisted transcript', async () => {
  const notification = await buildClosedConversationNotification({
    title: 'Pod audit',
    fetchMessages: async () => [
      user('how many pods?'),
      assistant('There are **12** pods running.'),
    ],
    wait: noWait,
  })

  assert.deepEqual(notification, { title: 'Pod audit', body: 'There are 12 pods running.' })
})

test('the transcript is refetched until the assistant turn has been persisted', async () => {
  const waits: number[] = []
  let fetches = 0
  const notification = await buildClosedConversationNotification({
    title: 'Pod audit',
    fetchMessages: async () => {
      fetches += 1

      return fetches < 3 ? [user('how many pods?')] : [user('how many pods?'), assistant('12.')]
    },
    wait: async (ms) => {
      waits.push(ms)
    },
  })

  assert.equal(notification.body, '12.')
  assert.equal(fetches, 3)
  assert.deepEqual(waits, CLOSED_TRANSCRIPT_RETRY_DELAYS_MS.slice(1))
})

test('a transcript that never catches up falls back to the generic closed sentence', async () => {
  let fetches = 0
  const notification = await buildClosedConversationNotification({
    title: 'Pod audit',
    fetchMessages: async () => {
      fetches += 1

      return [user('how many pods?')]
    },
    wait: noWait,
  })

  assert.equal(fetches, CLOSED_TRANSCRIPT_RETRY_DELAYS_MS.length)
  assert.equal(
    notification.body,
    'The agent stopped while this conversation was closed — open it to see what happened.',
  )
})

test('a failing fetch is retried and then falls back', async () => {
  let fetches = 0
  const notification = await buildClosedConversationNotification({
    title: '',
    fetchMessages: async () => {
      fetches += 1
      throw new Error('offline')
    },
    wait: noWait,
  })

  assert.equal(fetches, CLOSED_TRANSCRIPT_RETRY_DELAYS_MS.length)
  assert.equal(notification.title, 'Nuphos')
  assert.match(notification.body, /stopped while this conversation was closed/)
})

test('a turn parked on an approval gate says what it is waiting for', async () => {
  const notification = await buildClosedConversationNotification({
    title: 'Deploy',
    fetchMessages: async () => [
      user('restart it'),
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'I will restart the deployment.' },
          { type: 'tool', toolName: 'bash', state: 'approval-requested' },
        ],
      },
    ],
    wait: noWait,
  })

  assert.equal(notification.body, 'Waiting for your approval: bash\nI will restart the deployment.')
})
