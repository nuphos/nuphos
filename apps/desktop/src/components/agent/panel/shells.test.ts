import assert from 'node:assert/strict'
import test from 'node:test'

import { shellsFromRuntimeState } from './shells.ts'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

test('filters tools[] down to the ones carrying a terminal embed, in wire order', () => {
  const snapshot = {
    state: 'active',
    tools: [
      { id: 't1', status: 'running', title: 'read file' },
      {
        id: 't2',
        status: 'running',
        terminal: { terminalId: 'term-1', command: 'npm test', status: 'running' },
      },
      {
        id: 't3',
        status: 'completed',
        terminal: {
          terminalId: 'term-2',
          command: 'npm run build',
          output: 'built ok',
          status: 'exited',
          exit: { exitCode: 0, signal: null },
        },
      },
    ],
  } as RuntimeExecution

  assert.deepEqual(shellsFromRuntimeState(snapshot), [
    {
      id: 't2',
      terminalId: 'term-1',
      command: 'npm test',
      output: '',
      status: 'running',
      exitCode: undefined,
      signal: undefined,
    },
    {
      id: 't3',
      terminalId: 'term-2',
      command: 'npm run build',
      output: 'built ok',
      status: 'exited',
      exitCode: 0,
      signal: null,
    },
  ])
})

test('no terminal-bearing tools yields an empty list', () => {
  assert.deepEqual(shellsFromRuntimeState(undefined), [])
  assert.deepEqual(
    shellsFromRuntimeState({
      state: 'active',
      tools: [{ id: 't1', status: 'running' }],
    } as RuntimeExecution),
    [],
  )
})
