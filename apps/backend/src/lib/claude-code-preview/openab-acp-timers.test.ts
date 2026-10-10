import { describe, expect, spyOn, test } from 'bun:test'

import { createCallTimer, isTurnProgressUpdate } from './openab-acp-timers'

describe('isTurnProgressUpdate', () => {
  test.each([
    'agent_message_chunk',
    'agent_thought_chunk',
    'tool_call',
    'tool_call_update',
    'plan',
  ])('%s is progress', (sessionUpdate) => {
    expect(isTurnProgressUpdate({ sessionId: 's', update: { sessionUpdate } })).toBe(true)
  })

  test.each(['session_info_update', 'usage_update', 'runtime_state', 'available_commands_update'])(
    '%s is liveness only',
    (sessionUpdate) => {
      expect(isTurnProgressUpdate({ sessionId: 's', update: { sessionUpdate } })).toBe(false)
    },
  )

  test('rejects malformed params', () => {
    expect(isTurnProgressUpdate(undefined)).toBe(false)
    expect(isTurnProgressUpdate({ sessionId: 's' })).toBe(false)
  })
})

describe('createCallTimer', () => {
  test('progress restarts the progress window; liveness does not', async () => {
    let now = 0
    let fired = 0
    const clock = spyOn(Date, 'now').mockImplementation(() => now)
    const timer = createCallTimer(() => fired++, 1_000, 30)
    let handle: ReturnType<typeof setTimeout> | undefined

    try {
      now = 20
      clearTimeout(timer.arm(true))
      now = 40
      expect(timer.stalled()).toBe(false)
      handle = timer.arm(false)
      now = 60
      await Bun.sleep(30)
      expect(fired).toBe(1)
      expect(timer.timeoutError('session/prompt', true)).toMatchObject({
        message: 'OpenAB ACP session/prompt timed out: no turn progress for 0s',
        timeoutKind: 'progress',
        timeoutMs: 30,
      })
    } finally {
      clearTimeout(handle)
      clock.mockRestore()
    }
  })

  test('without a progress window only inactivity applies', () => {
    const timer = createCallTimer(() => {}, 1_000)

    clearTimeout(timer.arm())
    expect(timer.stalled()).toBe(false)
    expect(timer.timeoutError('session/prompt', true).message).toBe(
      'OpenAB ACP session/prompt timed out',
    )
    expect(timer.timeoutError('session/prompt', true)).toMatchObject({
      timeoutKind: 'inactivity',
      timeoutMs: 1_000,
    })
  })
})

test('a non-prompt call reports a call deadline rather than session inactivity', () => {
  const timer = createCallTimer(() => {}, 30000)

  expect(timer.timeoutError('session/new', false)).toMatchObject({
    timeoutKind: 'call-deadline',
    timeoutMs: 30000,
  })
})

test('deadline classification is sampled once even at the progress boundary', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(0)

  try {
    const timer = createCallTimer(() => {}, 1000, 30)

    clock.mockReturnValueOnce(29).mockReturnValue(31)
    expect(timer.timeoutError('session/prompt', true)).toMatchObject({
      message: 'OpenAB ACP session/prompt timed out',
      timeoutKind: 'inactivity',
      timeoutMs: 1000,
    })
  } finally {
    clock.mockRestore()
  }
})
