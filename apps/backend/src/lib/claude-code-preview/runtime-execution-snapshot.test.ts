import { expect, test } from 'bun:test'

import { parseSessionExecutionState } from './runtime-execution-snapshot'

test('legacy run-shaped and malformed replies never authorize execution', () => {
  for (const value of [
    { activeRun: { streamId: 'stale' } },
    { state: 'active' },
    { state: 'active', epoch: 'r', revision: -1 },
    { state: 'active', epoch: 'r', revision: '1' },
  ]) {
    expect(() => parseSessionExecutionState(value)).toThrow()
  }
  expect(parseSessionExecutionState({ state: 'dormant' })).toEqual({ state: 'dormant' })
  expect(parseSessionExecutionState({ state: 'idle', epoch: 'r', revision: 10 })).toEqual({
    state: 'idle',
    epoch: 'r',
    revision: 10,
  })
})

function lifecycleSnapshot(tools: unknown[]) {
  return {
    state: 'active',
    epoch: 'r',
    revision: 1,
    schemaVersion: 2,
    phase: 'p',
    label: 'l',
    actions: { send: true, cancel: false, steer: false },
    tools,
  }
}

test('tool entries without a terminal field parse unchanged', () => {
  const snapshot = lifecycleSnapshot([{ id: 't1', status: 'in_progress' }])

  expect(parseSessionExecutionState(snapshot).tools).toEqual([{ id: 't1', status: 'in_progress' }])
})

test('a running terminal with no exit info parses', () => {
  const snapshot = lifecycleSnapshot([
    {
      id: 't1',
      terminal: { terminalId: 'term-1', command: 'ls -la', output: 'a\n', status: 'running' },
    },
  ])

  expect(parseSessionExecutionState(snapshot).tools?.[0]?.terminal).toEqual({
    terminalId: 'term-1',
    command: 'ls -la',
    output: 'a\n',
    status: 'running',
  })
})

test('an exited terminal carries its exit info', () => {
  const snapshot = lifecycleSnapshot([
    {
      id: 't1',
      terminal: {
        terminalId: 'term-1',
        output: 'a\n',
        status: 'exited',
        exit: { exitCode: 0, signal: null },
      },
    },
  ])

  expect(parseSessionExecutionState(snapshot).tools?.[0]?.terminal?.status).toBe('exited')
  expect(parseSessionExecutionState(snapshot).tools?.[0]?.terminal?.exit).toEqual({
    exitCode: 0,
    signal: null,
  })
})

test('a malformed terminal is dropped from its own tool, not the whole snapshot', () => {
  const malformed = [
    { id: 't1', terminal: { status: 'running' } }, // missing terminalId
    { id: 't1', terminal: { terminalId: 'term-1', status: 'paused' } }, // invalid status enum
    { id: 't1', terminal: { terminalId: 'term-1', status: 'running', output: 123 } }, // wrong type
    { id: 't1', terminal: 'term-1' }, // not an object
  ]

  for (const tool of malformed) {
    const parsed = parseSessionExecutionState(lifecycleSnapshot([tool]))

    expect(parsed.tools).toEqual([{ id: 't1' }])
  }
})

test('one malformed terminal does not discard an unrelated live tool', () => {
  const snapshot = lifecycleSnapshot([
    { id: 't1', terminal: { terminalId: 'term-1', status: 'running' } },
    { id: 't2', terminal: { status: 'running' } }, // missing terminalId
  ])
  const parsed = parseSessionExecutionState(snapshot)

  expect(parsed.tools).toEqual([
    { id: 't1', terminal: { terminalId: 'term-1', status: 'running' } },
    { id: 't2' },
  ])
})
