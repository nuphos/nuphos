import { expect, test } from 'bun:test'

import {
  isRuntimeAuthRequired,
  OpenAbRpcError,
  RUNTIME_AUTH_REQUIRED_CODE,
  RUNTIME_AUTH_REQUIRED_MESSAGE,
} from './openab-acp-errors'
import { classifyPreviewInterruption } from './preview-transcript'

import { agentStreamErrorFrame, formatAgentStreamError } from '@/routes/agent/errors'

const codexFailure = (notice: string) =>
  new OpenAbRpcError(`**Internal Error** (code: -32603)\nInternal error\n> ${notice}`, -32603)

const refusals = {
  // Delivered by codex-acp@1.1.4 in production on 2026-11-16.
  discovery: codexFailure('workspace routing discovery unauthorized (401)'),
  // codex-rs login/src/auth/manager.rs, verbatim.
  refreshRevoked: codexFailure(
    'Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.',
  ),
  refreshExpired: codexFailure(
    'Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.',
  ),
}

test("Codex's sign-in refusals ask the user to sign the agent in again, live and stored alike", () => {
  for (const [kind, error] of Object.entries(refusals)) {
    expect([kind, isRuntimeAuthRequired(error)]).toEqual([kind, true])
    expect([kind, formatAgentStreamError(error)]).toEqual([kind, RUNTIME_AUTH_REQUIRED_MESSAGE])
    expect([kind, agentStreamErrorFrame(error, undefined).errorCode]).toEqual([
      kind,
      RUNTIME_AUTH_REQUIRED_CODE,
    ])
    expect([kind, classifyPreviewInterruption(error, false)]).toEqual([
      kind,
      { reason: 'error', message: RUNTIME_AUTH_REQUIRED_MESSAGE, cause: 'auth' },
    ])
  }
})

test('another Codex failure is not taken for a sign-in problem', () => {
  expect(isRuntimeAuthRequired(codexFailure('workspace routing discovery failed'))).toBe(false)
})
