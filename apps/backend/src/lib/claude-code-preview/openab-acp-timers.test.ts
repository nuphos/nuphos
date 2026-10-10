import { describe, expect, test } from 'bun:test'

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
    let fired = 0
    const timer = createCallTimer(() => fired++, 1_000, 30)

    await Bun.sleep(20)
    clearTimeout(timer.arm(true))
    await Bun.sleep(20)
    expect(timer.stalled()).toBe(false)

    const handle = timer.arm(false)

    await Bun.sleep(40)
    clearTimeout(handle)
    expect(fired).toBe(1)
    expect(timer.stalled()).toBe(true)
    expect(timer.timeoutError('session/prompt').message).toBe(
      'OpenAB ACP session/prompt timed out: no turn progress for 0s',
    )
  })

  test('without a progress window only inactivity applies', () => {
    const timer = createCallTimer(() => {}, 1_000)

    clearTimeout(timer.arm())
    expect(timer.stalled()).toBe(false)
    expect(timer.timeoutError('session/prompt').message).toBe('OpenAB ACP session/prompt timed out')
    expect(timer.timeoutError('session/prompt')).toMatchObject({
      timeoutKind: 'inactivity',
      timeoutMs: 1_000,
    })
  })
})
