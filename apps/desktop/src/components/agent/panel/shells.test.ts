import assert from 'node:assert/strict'
import test from 'node:test'

import { sessionDesktopsOf, shellsFromRuntimeState } from './shells.ts'

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

test('only the owner of a conversation on a desktop Box is offered "Desktop"', () => {
  const runtimeState = { state: 'idle', canOpenDesktop: true } as RuntimeExecution

  assert.equal(sessionDesktopsOf('t', { runtimeState }).canOpen, true)
  // A teammate's conversation: the Box would refuse them.
  assert.equal(sessionDesktopsOf('t', { runtimeState, foreign: true }).canOpen, false)
  // No desktop pool on its Box.
  assert.equal(sessionDesktopsOf('t', { runtimeState: { state: 'idle' } }).canOpen, false)
  // Still offered while the session holds a desktop, the only way to its tab.
  const holding = {
    state: 'idle',
    tools: [{ id: 'desktop:2', title: ':2', desktop: { display: 2 } }],
  } as RuntimeExecution

  assert.equal(sessionDesktopsOf('t', { runtimeState: holding }).canOpen, true)
  assert.equal(sessionDesktopsOf('t', { runtimeState: holding, foreign: true }).canOpen, false)
})

test('adds unfinished background tasks after terminals, skipping one already listed', () => {
  const snapshot = {
    state: 'idle',
    tools: [
      { id: 't1', terminal: { terminalId: 'term-1', command: 'npm test', status: 'running' } },
    ],
    asyncTasks: {
      a1: { id: 'a1', name: 'Explore repo', state: 'running' },
      a2: { id: 'a2', name: 'done', state: 'completed' },
      a3: { id: 'a3', name: 'npm test', state: 'running', toolCallId: 't1' },
      a4: { id: 'a4', state: 'pending' },
    },
  } as RuntimeExecution

  assert.deepEqual(
    shellsFromRuntimeState(snapshot).map((entry) => [entry.id, entry.command, entry.task ?? false]),
    [
      ['t1', 'npm test', false],
      ['a1', 'Explore repo', true],
      ['a4', 'a4', true],
    ],
  )
})
