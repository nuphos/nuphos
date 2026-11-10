import { expect, test } from 'bun:test'

import { CodexTurnFailedError } from '@/lib/claude-code-preview/codex-turn-failure'
import { OpenAbRpcError } from '@/lib/claude-code-preview/openab-acp-errors'

import { agentStreamErrorFrame } from './errors'

test('the ACP sign-out refusal reaches clients as a named product state', () => {
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError('**Server Error** (code: -32000)\nAuthentication required', -32000),
    undefined,
  )

  expect(frame.errorCode).toBe('runtime_auth_required')
  // The gateway's markdown wrapper is a dead end for the user: it names no
  // runtime, no account, and no action.
  expect(frame.errorText).not.toContain('-32000')
  expect(frame.errorText).toContain('Sign the agent in again')
})

test('a provider out of usage reaches clients as a named product state', () => {
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error\n> API error (status 402 Payment Required): Grok Build usage balance exhausted requestId=2e987add-d6e3-4193-905b-34c86d87bb62',
      -32603,
    ),
    undefined,
  )

  expect(frame.errorCode).toBe('runtime_usage_exhausted')
  expect(frame.errorText).toBe(
    'This agent’s provider account has no usage left (Grok Build usage balance exhausted). Add credits or wait for its allowance to reset, or switch to another agent, then resend your message.',
  )
})

test('a Claude usage limit reaches clients as its own notice', () => {
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError(
      "**Internal Error** (code: -32603)\nInternal error: You've hit your session limit · resets 4:20am (UTC)\n\n_The agent did not return any error details. Please check the agent's own logs for more information._",
      -32603,
    ),
    undefined,
  )

  expect(frame.errorCode).toBe('runtime_usage_exhausted')
  expect(frame.errorText).toBe("You've hit your session limit · resets 4:20am (UTC)")
})

test('other ACP refusals keep their diagnostics and stay uncoded', () => {
  const frame = agentStreamErrorFrame(new OpenAbRpcError('Runtime is busy', -32005), undefined)

  expect(frame.errorCode).toBeUndefined()
  expect(frame.errorText).toBe('Runtime is busy')
})

test('a runtime out of disk space names the fix and keeps the raw cause in details', () => {
  const raw =
    "**Internal Error** (code: -32603)\nInternal error\n> ENOSPC: no space left on device, mkdir '/home/node/x'"
  const frame = agentStreamErrorFrame(new OpenAbRpcError(raw, -32603), undefined)

  expect(frame.errorCode).toBe('runtime_disk_full')
  expect(frame.details).toMatchObject({ acp_error_code: -32603 })
  expect(frame.errorText).toContain('out of disk space')
  expect(frame.errorText).not.toContain('-32603')
  expect(JSON.stringify(frame.details)).toContain('ENOSPC')
})

test('an internal error with no cause says what to try instead of the JSON-RPC wrapper', () => {
  for (const message of [
    'JSON-RPC error -32603: Internal error',
    "**Internal Error** (code: -32603)\nInternal error\n\n_The agent did not return any error details. Please check the agent's own logs for more information._",
  ]) {
    const frame = agentStreamErrorFrame(new OpenAbRpcError(message, -32603), undefined)

    expect(frame.errorCode).toBe('runtime_internal_error')
    expect(frame.errorText).toContain('failed without saying why')
  }
})

test('an internal error that names its cause keeps that cause', () => {
  const message = '**Internal Error** (code: -32603)\nInternal error\n> model not found'
  const frame = agentStreamErrorFrame(new OpenAbRpcError(message, -32603), undefined)

  expect(frame.errorCode).toBeUndefined()
  expect(frame.errorText).toBe(message)
})

test('the implementation-defined -32000 bucket alone does not mean signed out', () => {
  // JSON-RPC leaves -32000..-32099 to the implementation, so another condition
  // may land on the same number. Mislabelling it would hide its diagnostics and
  // tell the user to sign in for something a retry would have fixed.
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError('**Server Error** (code: -32000)\nSession store is unavailable', -32000),
    undefined,
  )

  expect(frame.errorCode).toBeUndefined()
  expect(frame.errorText).toContain('Session store is unavailable')
})

test('the gateway relaying the sign-out refusal as -32603 is still a sign-out', () => {
  // Observed in production: openab answers session/prompt with JSON-RPC -32603
  // and keeps the adapter's -32000 only in the message wrapper.
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError('**Server Error** (code: -32000)\nAuthentication required', -32603),
    undefined,
  )

  expect(frame.errorCode).toBe('runtime_auth_required')
  expect(frame.errorText).toContain('Sign the agent in again')
})

test('a -32000 quoted outside the leading wrapper is not the adapter code', () => {
  // Only openab-core's `**<Label>** (code: N)\n` prefix names the adapter's
  // code; a tool or provider quoting one in its own text keeps its diagnostics.
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nMCP server github failed (code: -32000): Authentication required',
      -32603,
    ),
    undefined,
  )

  expect(frame.errorCode).toBeUndefined()
  expect(frame.errorText).toContain('MCP server github failed')
})

test('a Claude sign-in that expired reaches clients as a sign-out, not the gateway wrapper', () => {
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError(
      "**Internal Error** (code: -32603)\nInternal error: Failed to authenticate: OAuth session expired and could not be refreshed\n\n_The agent did not return any error details. Please check the agent's own logs for more information._",
      -32603,
    ),
    undefined,
  )

  expect(frame.errorCode).toBe('runtime_auth_required')
  expect(frame.errorText).toContain('Sign the agent in again')
})

test('Claude Code asking for /login reaches clients as a sign-out', () => {
  const frame = agentStreamErrorFrame(
    new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error: Invalid API key · Please run /login',
      -32603,
    ),
    undefined,
  )

  expect(frame.errorCode).toBe('runtime_auth_required')
  expect(frame.errorText).toContain('Sign the agent in again')
})

test('a provider-failed turn keeps its own notice even when it names a disk error', () => {
  const frame = agentStreamErrorFrame(
    new CodexTurnFailedError('upstream ENOSPC while caching the response'),
    undefined,
  )

  expect(frame.errorCode).not.toBe('runtime_disk_full')
  expect(frame.errorText).toContain('upstream ENOSPC')
})
