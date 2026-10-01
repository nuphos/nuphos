import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleChatHttpFailure } from './chat-http-failure.ts'
import { createChatStreamState } from './chat-shared.ts'
import {
  agentHttpProductEvent,
  agentReauthenticationEvent,
  formatAgentSseError,
} from './stream-errors.ts'

test('legacy subscription failures never open a payment flow', () => {
  assert.deepEqual(
    agentHttpProductEvent({
      code: 'subscription_required',
      message: 'Agent runs need a paid plan.',
      requestId: 'request-that-must-not-reach-the-card',
      status: 402,
      statusText: 'Payment Required',
    }),
    null,
  )
})

test('missing Claude Code setup becomes an actionable product event', () => {
  assert.deepEqual(
    agentHttpProductEvent({
      code: 'claude_code_setup_required',
      message: 'Bind a Claude Code OAuth token in Settings → Agent.',
      requestId: 'request-that-must-not-reach-the-card',
      status: 409,
      statusText: 'Conflict',
    }),
    {
      type: 'agent-setup-required',
      message: 'Bind a Claude Code OAuth token in Settings → Agent.',
    },
  )
})

test('conversation_busy becomes a product event instead of a stream failure', () => {
  assert.deepEqual(
    agentHttpProductEvent({
      code: 'conversation_busy',
      message: 'The agent is currently replying in the linked Slack thread.',
      status: 409,
      statusText: 'Conflict',
    }),
    {
      type: 'conversation-busy',
      message: 'The agent is currently replying in the linked Slack thread.',
    },
  )
})

test('runtime_not_accepting_message waits for the agent instead of surfacing HTTP 409', () => {
  assert.deepEqual(
    agentHttpProductEvent({
      code: 'runtime_not_accepting_message',
      message: 'Reading session settings',
      status: 409,
      statusText: 'Conflict',
    }),
    { type: 'runtime-not-ready', message: 'Reading session settings' },
  )
})

test('ACP connection failure keeps its request id in the renderer error event', () => {
  const formatted = formatAgentSseError(
    {
      type: 'error',
      errorText: 'Failed to connect to OpenAB ACP endpoint',
      requestId: 'f82dc1c3061aaa0c44abb824ae3e26bd',
    },
    {
      phase: 'sse_error_frame',
      streamId: 'stream-1',
      sessionId: 'session-1',
    },
  )

  assert.match(formatted, /^Agent stream failed\.\nFailed to connect to OpenAB ACP endpoint/m)
  assert.match(formatted, /requestId=f82dc1c3061aaa0c44abb824ae3e26bd/)
  assert.match(formatted, /context=phase=sse_error_frame streamId=stream-1 sessionId=session-1/)
})

test('missing Codex setup uses the same setup card with Codex-specific guidance', () => {
  const message = 'Run codex login, then bind auth.json in Settings → Agent.'

  assert.deepEqual(agentHttpProductEvent({ code: 'codex_setup_required', message, status: 409 }), {
    type: 'agent-setup-required',
    message,
  })
})

test('recognizes terminal refresh-token failures inside generic ACP errors', () => {
  for (const detail of [
    'Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.',
    'Your refresh token has expired. Please log in again.',
    'Your refresh token has already been used to generate a new access token.',
  ]) {
    const event = agentReauthenticationEvent({
      errorCode: '-32603',
      errorText: `**Internal Error** (code: -32603) Internal error > ${detail}`,
    })

    assert.equal(event?.type, 'agent-setup-required')
    assert.equal(event && 'reason' in event ? event.reason : undefined, 'reauthentication')
    assert.match(event?.message ?? '', /sign in again/)
  }
  for (const code of ['refresh_token_revoked', 'refresh_token_expired', 'refresh_token_reused']) {
    assert.equal(agentReauthenticationEvent({ code })?.type, 'agent-setup-required')
  }
})

test('a signed-out agent runtime opens the sign-in card instead of a stream failure', () => {
  const event = agentReauthenticationEvent({
    errorCode: 'runtime_auth_required',
    errorText:
      'This agent’s sign-in is no longer valid, so it could not start the turn. Sign the agent in again, then resend your message.',
  })

  assert.equal(event?.type, 'agent-setup-required')
  assert.equal(event && 'reason' in event ? event.reason : undefined, 'reauthentication')
  assert.match(event?.message ?? '', /sign in again/)
})

test('keeps transient failures and ordinary unauthorized errors out of runtime reauthentication', () => {
  for (const errorText of [
    '**Internal Error** (code: -32603) Internal error',
    'Could not refresh token: fetch failed',
    'Token refresh failed: service unavailable',
    'Access token expired',
    'Unauthorized',
  ]) {
    assert.equal(agentReauthenticationEvent({ errorText }), null)
  }
})

test('a revoked token in a gateway response stops before consuming any retry budget', async () => {
  const emitted: unknown[] = []
  const state = createChatStreamState(0)
  const result = await handleChatHttpFailure(
    {
      streamId: 'stream-1',
      sessionId: 'session-1',
      explicitResume: false,
      signal: new AbortController().signal,
      state,
      emit: (event) => emitted.push(event),
      noteFirstFrame: () => {},
    },
    new Response(JSON.stringify({ error: { message: 'Your refresh token was revoked.' } }), {
      status: 502,
    }),
    false,
  )

  assert.equal(result, 'stop')
  assert.equal(state.initialGatewayRetryAttempts, 0)
  assert.equal(emitted.length, 1)
  assert.equal((emitted[0] as { type: string }).type, 'agent-setup-required')
})
