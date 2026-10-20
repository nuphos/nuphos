import assert from 'node:assert/strict'
import test from 'node:test'

import { sessionActionGates } from './sessionActions.ts'

test('an unsaved fork offers no session actions', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 'fork-1', readOnly: false, unsaved: true }), {
    saved: false,
    canRename: false,
    canArchive: false,
    watching: undefined,
  })
})

test('a saved own chat offers rename and archive', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 's-1', readOnly: false }), {
    saved: true,
    canRename: true,
    canArchive: true,
    watching: undefined,
  })
  assert.equal(sessionActionGates({ sessionId: 's-1', unsaved: false }).saved, true)
})

test('a teammate chat is saved but only a manager may archive it', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 's-2', foreign: true }), {
    saved: true,
    canRename: false,
    canArchive: false,
    watching: undefined,
  })
  assert.equal(
    sessionActionGates({ sessionId: 's-2', foreign: true, canManage: true }).canArchive,
    true,
  )
})

test('read-only, archived and missing chats', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 's-3', readOnly: true }), {
    saved: true,
    canRename: false,
    canArchive: false,
    watching: undefined,
  })
  assert.equal(sessionActionGates({ sessionId: 's-4', archived: true }).canArchive, false)
  assert.equal(sessionActionGates(undefined).saved, false)
})

test('watching is reported only for a saved chat', () => {
  assert.equal(sessionActionGates({ sessionId: 's-5', watching: false }).watching, false)
  assert.equal(
    sessionActionGates({ sessionId: 's-5', foreign: true, watching: true }).watching,
    true,
  )
  assert.equal(
    sessionActionGates({ sessionId: 'fork-2', unsaved: true, watching: true }).watching,
    undefined,
  )
})
