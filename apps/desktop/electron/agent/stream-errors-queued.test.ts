import assert from 'node:assert/strict'
import { test } from 'node:test'

import { queuedNotice } from './stream-errors.ts'

test('a queued send says why it waits only when the server does', async () => {
  const reply = (body: string) => new Response(body, { status: 202 })

  assert.deepEqual(
    await queuedNotice(
      reply(JSON.stringify({ status: 'queued', message: 'Waiting for the owner' })),
    ),
    { message: 'Waiting for the owner' },
  )
  assert.deepEqual(await queuedNotice(reply(JSON.stringify({ status: 'queued' }))), {})
  assert.deepEqual(await queuedNotice(reply('')), {})
})

test('a send waiting on a sign-in names who it waits for', async () => {
  const body = { status: 'queued', message: 'Waiting for Bryan to sign in.', waitingFor: 'Bryan' }

  assert.deepEqual(await queuedNotice(new Response(JSON.stringify(body), { status: 202 })), {
    message: 'Waiting for Bryan to sign in.',
    waitingFor: 'Bryan',
  })
})
