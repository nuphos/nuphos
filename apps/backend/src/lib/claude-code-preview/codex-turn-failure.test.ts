import { expect, test } from 'bun:test'

import {
  CodexTurnFailedError,
  partsWithoutFailureNotice,
  withoutFailureNotice,
} from './codex-turn-failure'
import { OpenAbRpcError } from './openab-acp-errors'
import { classifyPreviewInterruption } from './preview-transcript'

import type { UIMessage } from 'ai'

import { formatAgentStreamError } from '@/routes/agent/errors'

const NOTICE =
  'This request was blocked by our safety systems. Reason: Potentially unintended activity.\n\n'

test('the provider notice is split off the streamed answer', () => {
  const error = new CodexTurnFailedError(NOTICE)

  expect(withoutFailureNotice(`我查一下目前${NOTICE}`, error)).toBe('我查一下目前')
  expect(withoutFailureNotice(`我查一下目前${NOTICE}`, new Error('boom'))).toBe(
    `我查一下目前${NOTICE}`,
  )
  expect(withoutFailureNotice('unrelated text', error)).toBe('unrelated text')
})

test('only a trailing text part loses the notice, and an emptied part is dropped', () => {
  const error = new CodexTurnFailedError(NOTICE)
  const tool = { type: 'tool-exec', toolCallId: 't', state: 'output-available' }
  const parts = [
    { type: 'text', text: 'Checking pods.' },
    tool,
    { type: 'text', text: `我查一下目前${NOTICE}` },
  ] as unknown as UIMessage['parts']

  expect(partsWithoutFailureNotice(parts, error)).toEqual([
    { type: 'text', text: 'Checking pods.' },
    tool,
    { type: 'text', text: '我查一下目前' },
  ] as unknown as UIMessage['parts'])
  expect(
    partsWithoutFailureNotice(
      [tool, { type: 'text', text: NOTICE }] as unknown as UIMessage['parts'],
      error,
    ),
  ).toEqual([tool] as unknown as UIMessage['parts'])
  expect(partsWithoutFailureNotice([tool] as unknown as UIMessage['parts'], error)).toEqual([
    tool,
  ] as unknown as UIMessage['parts'])
})

test('a provider-failed turn is reported with the provider message, not a runtime failure', () => {
  expect(classifyPreviewInterruption(new CodexTurnFailedError(NOTICE), false)).toEqual({
    reason: 'error',
    message:
      'The model provider stopped this turn: This request was blocked by our safety systems. Reason: Potentially unintended activity.',
  })
  expect(classifyPreviewInterruption(new CodexTurnFailedError(NOTICE), true).reason).toBe(
    'cancelled',
  )
})

test('a Claude usage limit is one line: the streamed notice gives way to the interruption', () => {
  const error = new OpenAbRpcError(
    "**Internal Error** (code: -32603)\nInternal error: You've hit your session limit · resets 4:20am (UTC)\n\n_The agent did not return any error details. Please check the agent's own logs for more information._",
    -32603,
  )
  const notice = "You've hit your session limit · resets 4:20am (UTC)"

  expect(
    partsWithoutFailureNotice([{ type: 'text', text: notice }] as UIMessage['parts'], error),
  ).toEqual([])
  expect(classifyPreviewInterruption(error, false)).toEqual({ reason: 'error', message: notice })
})

test("only the gateway wrapper's first line names a usage limit", () => {
  const memory = new OpenAbRpcError(
    "**Internal Error** (code: -32603)\nInternal error: You're out of memory",
    -32603,
  )
  const quoted = new OpenAbRpcError(
    "**Internal Error** (code: -32603)\nInternal error: boom\nInternal error: You've hit your session limit",
    -32603,
  )
  const unwrapped = new Error("Internal error: You've hit your session limit")

  // Not a usage limit: each keeps the runtime's own first line, or the plain fallback.
  expect(classifyPreviewInterruption(memory, false).message).toBe("You're out of memory")
  expect(classifyPreviewInterruption(quoted, false).message).toBe('boom')
  expect(classifyPreviewInterruption(unwrapped, false).message).toBe(
    'The agent failed before it could answer.',
  )
  for (const error of [memory, quoted, unwrapped]) {
    expect(withoutFailureNotice("You've hit your session limit", error)).toBe(
      "You've hit your session limit",
    )
  }
})

test('a dead Claude Code process is one line: the runtime names why, live and stored alike', () => {
  const cause =
    "Claude Code ran out of memory: this computer's agents reached their memory limit (3.6 GB) and the system stopped it. Send a message to continue."
  const error = new OpenAbRpcError(
    `**Internal Error** (code: -32603)\nInternal error: ${cause}`,
    -32603,
  )

  expect(classifyPreviewInterruption(error, false)).toEqual({ reason: 'error', message: cause })
  expect(formatAgentStreamError(error)).toBe(cause)
  expect(classifyPreviewInterruption(error, true).reason).toBe('cancelled')
})

test('a Claude sign-in failure is one line: the streamed notice gives way to the sign-in guidance', () => {
  const notice = 'Failed to authenticate: OAuth session expired and could not be refreshed'
  const error = new OpenAbRpcError(
    `**Internal Error** (code: -32603)\nInternal error: ${notice}\n\n_The agent did not return any error details. Please check the agent's own logs for more information._`,
    -32603,
  )

  expect(
    partsWithoutFailureNotice([{ type: 'text', text: notice }] as UIMessage['parts'], error),
  ).toEqual([])
  expect(classifyPreviewInterruption(error, false).message).toContain('Sign the agent in again')
})
