import { expect, test } from 'bun:test'

import { queuedReply } from './session-queue-share-approval'

test('a send held for a sign-in tells the desktop who it waits for', () => {
  expect(
    queuedReply('s1', { waiting: 'sign_in', message: 'Waiting for Bryan…', askedName: 'Bryan' }),
  ).toEqual({
    status: 'queued',
    streamId: 's1',
    message: 'Waiting for Bryan…',
    waitingFor: 'Bryan',
  })
  expect(
    queuedReply('s1', { waiting: 'share_approval', message: 'Waiting for the owner' }),
  ).toEqual({
    status: 'queued',
    streamId: 's1',
    message: 'Waiting for the owner',
  })
  expect(queuedReply('s1', null)).toEqual({ status: 'queued', streamId: 's1' })
})
