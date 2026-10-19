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
