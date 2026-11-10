import { expect, test } from 'bun:test'

import { recordSteerSender, takeSteerSender } from './steer-senders'

import type { MessageMetadata } from './message-metadata'

const CHANNEL: MessageMetadata = {
  version: 1,
  sender: { type: 'system', id: 'channel:c1', displayName: 'Nuphos channel' },
  source: 'agent.resource',
  resourceUrl: '/teams/t/agent/c1',
  sentAt: '2026-11-10T00:00:00.000Z',
}

test("a steer's receipt reads back the sender recorded under its id, for its session only", async () => {
  await recordSteerSender('s1', 'm1', CHANNEL)

  expect(await takeSteerSender('s2', 'm1')).toBeUndefined()
  expect(await takeSteerSender('s1', 'm1')).toEqual(CHANNEL)
  expect(await takeSteerSender('s1', 'unknown')).toBeUndefined()
})
