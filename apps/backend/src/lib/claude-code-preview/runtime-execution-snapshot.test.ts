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

test("the agent's slash commands pass through, shaped for a picker", () => {
  const snapshot = {
    ...lifecycleSnapshot([]),
    commands: [
      { name: 'review', description: 'Review the diff', hint: 'branch' },
      { name: 'compact', description: 'Compact the context' },
      { name: 'two words', description: 'not a command name' },
      { name: '<img>', description: 'markup' },
      { description: 'no name' },
      'not an object',
      { name: 'long', description: 'x'.repeat(2_000) },
    ],
  }

  expect(parseSessionExecutionState(snapshot).commands).toEqual([
    { name: 'review', description: 'Review the diff', hint: 'branch' },
    { name: 'compact', description: 'Compact the context' },
    { name: 'long', description: 'x'.repeat(200) },
  ])
})

test('a snapshot without commands, or with a malformed list, has none', () => {
  expect(parseSessionExecutionState(lifecycleSnapshot([])).commands).toBeUndefined()
  expect(
    parseSessionExecutionState({ ...lifecycleSnapshot([]), commands: null }).commands,
  ).toBeUndefined()
  expect(
    parseSessionExecutionState({ ...lifecycleSnapshot([]), commands: 'review' }).commands,
  ).toBeUndefined()
})

test('a repeated name keeps its first entry, and the list stops at 100', () => {
  const many = Array.from({ length: 150 }, (_, index) => ({
    name: `c${String(index)}`,
    description: '',
  }))
  const commands = parseSessionExecutionState({
    ...lifecycleSnapshot([]),
    commands: [
      { name: 'review', description: 'first' },
      { name: 'review', description: 'again' },
      ...many,
    ],
  }).commands

  expect(commands?.[0]).toEqual({ name: 'review', description: 'first' })
  expect(commands?.filter((command) => command.name === 'review')).toHaveLength(1)
  expect(commands).toHaveLength(100)
})
