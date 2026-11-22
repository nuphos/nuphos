import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { systemSender } from './message-metadata'
import { TRIGGER_SENDER_PREFIX } from './trigger-missed-runs'
import { liveTriggerMessages } from './trigger-pending'

import type { PendingUserMessage } from './pending-messages'

const stale = new ObjectId().toHexString()
const live = new ObjectId().toHexString()
const event = (id: string) =>
  ({
    id,
    source: 'agent.resource',
    renderedText: 'fixture',
    metadata: systemSender(`${TRIGGER_SENDER_PREFIX}${id}`, 'Fixture', '/test'),
  }) as PendingUserMessage
const other = {
  id: 'other',
  source: 'agent.resource',
  renderedText: 'fixture',
  metadata: systemSender('github', 'GitHub', '/test'),
} as PendingUserMessage

describe('liveTriggerMessages', () => {
  test('drops a deleted Trigger after restore and keeps another Trigger and a resource event', async () => {
    const messages = [event(stale), event(live), other]
    const kept = await liveTriggerMessages('task', messages, {
      archived: async () => false,
      live: async (id) => id === live,
    })

    expect(kept.map((message) => message.id)).toEqual([live, 'other'])
  })

  test('never runs a Trigger while its Task is archived', async () => {
    const kept = await liveTriggerMessages('task', [event(live), other], {
      archived: async () => true,
      live: async () => true,
    })

    expect(kept).toEqual([other])
  })
})
