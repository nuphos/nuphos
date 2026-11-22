import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { openCodeRefusal, openCodeStatusRefusal } from '../image/opencode-session.mjs'

test('a free-tier retry for the requested session returns its message', () => {
  const status = {
    ses_a: { type: 'retry', message: 'Free usage exceeded', action: { reason: 'free_tier_limit' } },
  }

  assert.equal(openCodeStatusRefusal(status, 'ses_a'), 'Free usage exceeded')
  assert.equal(openCodeStatusRefusal(status, 'ses_b'), undefined)
  assert.equal(
    openCodeStatusRefusal(
      { ses_a: { type: 'retry', message: 'Free usage limit reached' } },
      'ses_a',
    ),
    'Free usage limit reached',
  )
})

test('status is read over loopback with authentication and scoped to the session', async () => {
  const server = createServer((request, response) => {
    assert.equal(request.url, '/session/status?directory=%2Ftmp%2Fproject')
    assert.equal(
      request.headers.authorization,
      `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
    )
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        ses_a: {
          type: 'retry',
          message: 'Free usage exceeded',
          action: { reason: 'free_tier_limit' },
        },
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const endpoint = { port: server.address().port, password: 'secret' }

    assert.equal(await openCodeRefusal(endpoint, 'ses_a', '/tmp/project'), 'Free usage exceeded')
    assert.equal(await openCodeRefusal(endpoint, 'ses_b', '/tmp/project'), undefined)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('other statuses, retry reasons and malformed responses do not end a turn', () => {
  for (const status of [
    null,
    {},
    {
      ses_a: {
        type: 'busy',
        message: 'Free usage exceeded',
        action: { reason: 'free_tier_limit' },
      },
    },
    { ses_a: { type: 'retry', message: 'Temporary failure', action: { reason: 'network_error' } } },
    { ses_a: { type: 'retry', action: { reason: 'free_tier_limit' } } },
  ])
    assert.equal(openCodeStatusRefusal(status, 'ses_a'), undefined)
})
