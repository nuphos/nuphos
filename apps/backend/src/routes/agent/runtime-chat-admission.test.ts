import { expect, test } from 'bun:test'
import { admitRuntimeChat, assertRuntimeChatAdmission } from './runtime-chat-admission'

import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

const settling: SessionExecutionState = {
  schemaVersion: 2,
  state: 'idle',
  label: 'Reading session settings',
  actions: { send: false, cancel: false, steer: false },
}
const ready: SessionExecutionState = {
  schemaVersion: 2,
  state: 'idle',
  actions: { send: true, cancel: false, steer: false },
}

function reader(sequence: SessionExecutionState[]) {
  let reads = 0

  return {
    read: () => Promise.resolve(sequence[Math.min(reads++, sequence.length - 1)]!),
    reads: () => reads,
  }
}

test('a transient refusal is re-checked until the runtime accepts the message', async () => {
  const status = reader([settling, settling, ready])

  await admitRuntimeChat(settling, {
    attached: {},
    replying: false,
    read: status.read,
    retryMs: 1,
  })
  expect(status.reads()).toBe(3)
})

test('a refusal that outlasts the budget still answers runtime_not_accepting_message', async () => {
  const status = reader([settling])

  await expect(
    admitRuntimeChat(settling, {
      attached: {},
      replying: false,
      read: status.read,
      budgetMs: 40,
      retryMs: 5,
    }),
  ).rejects.toMatchObject({ status: 409, code: 'runtime_not_accepting_message' })
  expect(status.reads()).toBeGreaterThan(0)
})

test('a running turn or a pending user request is refused without waiting', async () => {
  for (const snapshot of [
    { ...settling, state: 'active' as const },
    { ...settling, requestPending: true },
  ]) {
    const status = reader([ready])

    await expect(
      admitRuntimeChat(snapshot, { attached: {}, replying: false, read: status.read, retryMs: 1 }),
    ).rejects.toMatchObject({ code: 'runtime_not_accepting_message' })
    expect(status.reads()).toBe(0)
  }
})

test('an attached session never falls back to backend admission when runtime state is missing', () => {
  expect(() => assertRuntimeChatAdmission(undefined, true, false)).toThrow(
    'authoritative agent status',
  )
  expect(() => assertRuntimeChatAdmission({ state: 'idle' }, true, false)).toThrow(
    'authoritative agent status',
  )
})

test('runtime capabilities decide admission even when coarse state is idle', () => {
  expect(() =>
    assertRuntimeChatAdmission(
      {
        schemaVersion: 2,
        state: 'idle',
        label: 'Reading session settings',
        actions: { send: false, cancel: false, steer: false },
      },
      true,
      false,
    ),
  ).toThrow('Reading session settings')
  expect(() =>
    assertRuntimeChatAdmission(
      { schemaVersion: 2, state: 'idle', actions: { send: true, cancel: false, steer: false } },
      true,
      false,
    ),
  ).not.toThrow()
})

test('an expired runtime reply cannot become an ordinary new prompt', () => {
  expect(() =>
    assertRuntimeChatAdmission(
      { schemaVersion: 2, state: 'idle', actions: { send: true, cancel: false, steer: false } },
      true,
      true,
    ),
  ).toThrow('no longer waiting')
})
