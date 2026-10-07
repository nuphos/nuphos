import assert from 'node:assert/strict'
import test from 'node:test'

import { shellsFromRuntimeState } from './shells.ts'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

test('keeps only running terminals, in wire order', () => {
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
        status: 'in_progress',
        terminal: { terminalId: 'term-2', command: 'npm run build', status: 'exited' },
      },
    ],
  } as RuntimeExecution

  assert.deepEqual(shellsFromRuntimeState(snapshot), [
    { id: 't2', terminalId: 'term-1', command: 'npm test', output: '' },
  ])
})

test('no running terminals yields an empty list', () => {
  assert.deepEqual(shellsFromRuntimeState(undefined), [])
  assert.deepEqual(
    shellsFromRuntimeState({
      state: 'active',
      tools: [{ id: 't1', status: 'running' }],
    } as RuntimeExecution),
    [],
  )
})
