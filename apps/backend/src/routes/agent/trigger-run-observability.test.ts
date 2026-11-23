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

test('a Codex usage limit is not reported', () => {
  recordTriggerRunFailure(
    new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error\n> You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:12 PM.',
      -32603,
      { code: -32603, message: 'Internal error' },
    ),
    trace,
    'agent.thread',
  )

  expect(captured).toHaveLength(0)
})

test('a usage limit the queue waits out is a warning, not a failed turn', () => {
  // #4164: a channel's wake out of usage logged an error, and an error line, on every try.
  const limit = () => notice("You've hit your session limit · resets 4pm (UTC)")

  expect(
    recordTriggerRunFailure(limit(), trace, 'agent.resource', {}, { waitsOutUsage: true }),
  ).toBe(false)
  // Sent once, it is a failed turn that says so.
  expect(recordTriggerRunFailure(limit(), trace, 'agent.resource')).toBe(true)
  expect(captured).toHaveLength(0)
})

test('a busy runtime is not reported: the message waits and runs after the turn ahead', () => {
  // The runtime names what it is busy with; the refusal carries that label.
  for (const label of ['Running tools…', 'Responding…', 'Reading or updating session settings…'])
    recordTriggerRunFailure(
      new AppError(409, 'runtime_not_accepting_message', label),
      trace,
      'agent.resource',
    )

  expect(captured).toHaveLength(0)
})

test("the user's own setup is not reported: a conversation too long, or a model the endpoint lacks", () => {
  recordTriggerRunFailure(
    notice(
      '{"message":"OpenCode Go: Upstream request failed: [400003] Input tokens exceed the model context limit.","type":"api_error","code":"context_length_exceeded"}',
    ),
    trace,
    'agent.resource',
  )
  recordTriggerRunFailure(
    notice(
      "API Error: 400 400: {'error': 'anthropic_messages: Invalid model name passed in model=claude-opus-5-5. Call `/v1/models` to view available models for your key.'}",
    ),
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
