// A turn another session or an event started fails in Error Tracking only when
// something broke. An offline computer, a provider usage limit or a missing
// sign-in is the agent's own state, which the app already names (#3018).
import { beforeEach, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { usePosthog } from '@/lib/test/doubles/posthog'

const captured: unknown[] = []

usePosthog({
  captureException: (error) => {
    captured.push(error)
  },
})

const { recordTriggerRunFailure } = await import('./trigger-run-observability')
const { RuntimeStateProbeError } = await import('@/lib/claude-code-preview/turn-diagnostics')
const { OpenAbRpcError } = await import('@/lib/claude-code-preview/openab-acp-errors')

const trace = {
  requestId: 'r-1',
  userId: 'u-1',
  sessionId: 's-1',
  teamId: 't-1',
  streamId: 'st-1',
  route: 'agent.thread',
  method: 'POST',
}
const notice = (text: string) =>
  new OpenAbRpcError(`**Internal Error** (code: -32603)\nInternal error: ${text}`, -32603)
const offline = () =>
  new AppError(409, 'runtime_offline', 'The computer running this agent is offline.')

beforeEach(() => {
  captured.length = 0
})

test('an offline computer is not reported, directly or behind the state probe', async () => {
  recordTriggerRunFailure(offline(), trace, 'agent.thread')
  recordTriggerRunFailure(await RuntimeStateProbeError.from(offline()), trace, 'agent.thread')

  expect(captured).toHaveLength(0)
})

test('a provider usage limit or a missing sign-in is not reported', () => {
  recordTriggerRunFailure(
    notice("You've hit your weekly limit · resets 4pm (UTC)"),
    trace,
    'agent.thread',
  )
  recordTriggerRunFailure(
    notice('Failed to authenticate: OAuth session expired'),
    trace,
    'agent.resource',
  )
  recordTriggerRunFailure(
    new OpenAbRpcError('**Server Error** (code: -32000)\nAuthentication required', -32000),
    trace,
    'agent.thread',
  )

  expect(captured).toHaveLength(0)
})

test('a probe that times out, and any other failure, are still reported', async () => {
  const timeout = await RuntimeStateProbeError.from(new Error('OpenAB ACP initialize timed out'))

  recordTriggerRunFailure(timeout, trace, 'agent.thread')
  recordTriggerRunFailure(new Error('Resource not found'), trace, 'agent.resource')

  expect(captured).toHaveLength(2)
})
