import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import {
  turnFailureCause,
  OpenAbRpcError,
  isSessionOutputSinkUnavailable,
  retrySessionPromptWhenBusy,
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
    expect(turnFailureCause(new AppError(409, 'conversation_busy', 'Busy'))).toBe('other')
    expect(turnFailureCause(new Error('internal detail'))).toBe('other')
  })
})
