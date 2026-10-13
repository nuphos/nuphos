import { expect, test } from 'bun:test'

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

test('other ACP refusals keep their diagnostics and stay uncoded', () => {
  const frame = agentStreamErrorFrame(new OpenAbRpcError('Runtime is busy', -32005), undefined)

  expect(frame.errorCode).toBeUndefined()
  expect(frame.errorText).toBe('Runtime is busy')
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
