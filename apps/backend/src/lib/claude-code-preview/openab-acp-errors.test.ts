import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import {
  acpErrorCode,
  claudeNotice,
  isRuntimeAuthRequired,
  settlePendingCall,
  turnFailureCause,
  OpenAbRpcError,
  isSessionOutputSinkUnavailable,
  retrySessionPromptWhenBusy,
  runtimeUsageExhaustedMessage,
  SESSION_OUTPUT_SINK_UNAVAILABLE,
} from './openab-acp-errors'

describe('retrySessionPromptWhenBusy', () => {
  test('retries a prompt rejected before dispatch until the active sink drains', async () => {
    let calls = 0
    const retries: number[] = []
    const result = await retrySessionPromptWhenBusy(
      () => {
        calls++
        if (calls < 3) return Promise.reject(new Error(SESSION_OUTPUT_SINK_UNAVAILABLE))

        return Promise.resolve('done')
      },
      { delaysMs: [0, 0], onRetry: (attempt) => retries.push(attempt) },
    )

    expect(result).toBe('done')
    expect(calls).toBe(3)
    expect(retries).toEqual([1, 2])
  })

  test('does not retry unrelated ACP failures', async () => {
    let calls = 0
    const result = retrySessionPromptWhenBusy(
      () => {
        calls++

        return Promise.reject(new Error('permission denied'))
      },
      { delaysMs: [0] },
    )

    expect(isSessionOutputSinkUnavailable(new Error('permission denied'))).toBe(false)
    await expect(result).rejects.toThrow('permission denied')
    expect(calls).toBe(1)
  })
})

describe('turnFailureCause', () => {
  const wrapped = (notice: string) =>
    new OpenAbRpcError(`**Internal Error** (code: -32603)\nInternal error: ${notice}`, -32603)

  test('names the agent’s own reason a turn could not run', () => {
    expect(turnFailureCause(wrapped("You've hit your weekly limit · resets 4pm (UTC)"))).toBe(
      'usage_limit',
    )
    expect(turnFailureCause(wrapped('Failed to authenticate: OAuth session expired'))).toBe('auth')
    expect(turnFailureCause(new AppError(409, 'runtime_login_required', 'Signed out'))).toBe('auth')
    expect(turnFailureCause(new AppError(503, 'claude_code_runtime_offline', 'Offline'))).toBe(
      'offline',
    )
    expect(turnFailureCause(new AppError(409, 'runtime_disabled', 'Retired'))).toBe('offline')
    expect(turnFailureCause(new AppError(409, 'conversation_busy', 'Busy'))).toBe('other')
  })

  test('a Codex usage limit, on a > detail line, is the agent out of usage', () => {
    // Runtime v0.1.50+ relays the adapter's bare message; the notice is only in the display text.
    const relayed = new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error\n> You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:12 PM.',
      -32603,
      {
        code: -32603,
        message: 'Internal error',
      },
    )
    // Older runtimes send the display wrapper alone.
    const wrappedOnly = new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error\n> You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:12 PM.',
      -32603,
    )

    expect(turnFailureCause(relayed)).toBe('usage_limit')
    expect(turnFailureCause(wrappedOnly)).toBe('usage_limit')
    expect(turnFailureCause(new Error('internal detail'))).toBe('other')
  })

  test('a Codex usage limit hit while compacting is the agent out of usage', () => {
    // As production logged it from codex-acp 1.1.4.
    const compacting = new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error\n> Error running remote compact task: You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 27th, 2026 3:22 AM.',
      -32603,
      { code: -32603, message: 'Internal error' },
    )

    expect(turnFailureCause(compacting)).toBe('usage_limit')
    expect(claudeNotice(compacting)).toStartWith('You’ve hit your usage limit.')
  })

  test('a provider’s 401 for the API key behind Codex is a sign-in to repair', () => {
    // As production logged it (#3926), with a stand-in key.
    const rejected = new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error\n> unexpected status 401 Unauthorized: Incorrect API key provided: sk-e2e****0000. You can find your API key at https://platform.openai.com/account/api-keys., url: https://api.openai.com/v1/responses, auth error: 401, auth error code: invalid_api_key',
      -32603,
      { code: -32603, message: 'Internal error' },
    )

    expect(turnFailureCause(rejected)).toBe('auth')
    expect(isRuntimeAuthRequired(rejected)).toBe(true)
  })

  test('an account Anthropic holds for verification is refused like one out of usage', () => {
    // The refusal production logged (#3926), with a stand-in org id.
    const notice =
      "API Error: Your account can't receive replies from Claude right now. You can find the next step in the Anthropic Verification Portal: https://portal.anthropic.com/verify?org=00000000-0000-4000-8000-000000000000"
    const refused = new OpenAbRpcError(
      `**Internal Error** (code: -32603)\nInternal error: ${notice}\n> {"errorKind":"verification_required"}`,
      -32603,
    )

    expect(turnFailureCause(refused)).toBe('usage_limit')
    expect(runtimeUsageExhaustedMessage(refused)).toBe(notice)
    expect(isRuntimeAuthRequired(refused)).toBe(false)
  })

  test('OpenCode’s free usage limit, as the runtime relays it, is the agent out of usage', () => {
    const notice =
      'The model provider refused the request: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go'
    const refused = wrapped(notice)

    expect(turnFailureCause(refused)).toBe('usage_limit')
    expect(runtimeUsageExhaustedMessage(refused)).toBe(notice)
    // Any other refusal the runtime relays stays unclassified.
    expect(turnFailureCause(wrapped('The model provider refused the request: overloaded'))).toBe(
      'other',
    )
  })
})

describe('the adapter error behind the gateway', () => {
  /** What the gateway sends: its own -32603, the display text, and the adapter's error in data. */
  const rejected = (error: Record<string, unknown>) => {
    let reason: unknown

    settlePendingCall(
      {
        resolve: () => undefined,
        reject: (e) => {
          reason = e
        },
        timer: setTimeout(() => undefined, 0),
      },
      { jsonrpc: '2.0', id: 1, error },
    )

    return reason as OpenAbRpcError
  }

  test('is read from error.data, whatever the display text says', () => {
    const authRequired = rejected({
      code: -32603,
      message: 'Sign-in needed',
      data: { code: -32000, message: 'Authentication required' },
    })
    const notice = rejected({
      code: -32603,
      message: 'The agent failed',
      data: { code: -32603, message: "Internal error: You've hit your weekly limit" },
    })

    expect(acpErrorCode(authRequired)).toBe(-32000)
    expect(isRuntimeAuthRequired(authRequired)).toBe(true)
    expect(claudeNotice(notice)).toBe("You've hit your weekly limit")
    expect(turnFailureCause(notice)).toBe('usage_limit')
  })

  test('falls back to the display wrapper from runtimes before v0.1.50', () => {
    const legacy = rejected({
      code: -32603,
      message: '**Server Error** (code: -32000)\nAuthentication required',
    })

    expect(legacy.adapter).toBeUndefined()
    expect(acpErrorCode(legacy)).toBe(-32000)
    expect(isRuntimeAuthRequired(legacy)).toBe(true)
  })

  test('ignores a data shape that is not the adapter error', () => {
    const other = rejected({ code: -32603, message: 'boom', data: { details: 'disk full' } })

    expect(other.adapter).toBeUndefined()
    expect(acpErrorCode(other)).toBe(-32603)
    expect(isRuntimeAuthRequired(other)).toBe(false)
    expect(claudeNotice(other)).toBeUndefined()
  })
})
