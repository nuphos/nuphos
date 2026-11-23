import { afterEach, expect, spyOn, test } from 'bun:test'

import { OpenAbConnectError } from './openab-acp-connect'
import { OpenAbConnectionLostError } from './openab-acp-errors'
import { answerPermissionRequest } from './openab-acp-permission'

import type { OpenAbPermissionOutcome } from './openab-acp-session'

const error = spyOn(console, 'error').mockImplementation(() => {})
const warn = spyOn(console, 'warn').mockImplementation(() => {})

afterEach(() => {
  error.mockClear()
  warn.mockClear()
})

/** Answers one request whose handler throws `thrown`; returns what the runtime was sent. */
async function answer(thrown: Error) {
  const sent: OpenAbPermissionOutcome[] = []

  await answerPermissionRequest({
    params: { sessionId: 's', toolCall: { toolCallId: 't' }, options: [] },
    targets: [{ sessionId: 's', onPermissionRequest: () => Promise.reject(thrown) }],
    send: (result) => sent.push(result),
  })

  return sent
}

const logged = (spy: typeof error) => spy.mock.calls.map(([line]) => String(line))

test.each([
  [
    'did not take the connection',
    new OpenAbConnectError('Failed to connect to OpenAB ACP endpoint'),
  ],
  ['hung up mid-call', new OpenAbConnectionLostError('socket closed')],
])(
  'a host that %s, as while it restarts, cancels the request with a warning, not an error',
  async (_case, thrown) => {
    expect(await answer(thrown)).toEqual([{ outcome: { outcome: 'cancelled' } }])
    expect(logged(error)).toEqual([])
    expect(logged(warn).join()).toContain('agent.openab_permission.host_away')
  },
)

test('any other handler failure still cancels the request and is logged as an error', async () => {
  expect(await answer(new Error('decision store down'))).toEqual([
    { outcome: { outcome: 'cancelled' } },
  ])
  expect(logged(error).join()).toContain('agent.openab_permission.handler_failed')
})
