import assert from 'node:assert/strict'
import test from 'node:test'

import { serverHasConversation, sessionActionGates } from './sessionActions.ts'

test('an unsaved fork offers no session actions', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 'fork-1', readOnly: false, unsaved: true }), {
    saved: false,
    canRename: false,
    canArchive: false,
    watching: undefined,
  })
})

test('a saved own chat offers rename and archive', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 's-1', readOnly: false, openedAt: 1 }), {
    saved: true,
    canRename: true,
    canArchive: true,
    watching: undefined,
  })
  assert.equal(sessionActionGates({ sessionId: 's-1', unsaved: false, openedAt: 1 }).saved, true)
})

test('a teammate chat is saved but only a manager may archive it', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 's-2', foreign: true, openedAt: 1 }), {
    saved: true,
    canRename: false,
    canArchive: false,
    watching: undefined,
  })
  assert.equal(
    sessionActionGates({ sessionId: 's-2', foreign: true, canManage: true, openedAt: 1 })
      .canArchive,
    true,
  )
})

test('read-only, archived and missing chats', () => {
  assert.deepEqual(sessionActionGates({ sessionId: 's-3', readOnly: true, openedAt: 1 }), {
    saved: true,
    canRename: false,
    canArchive: false,
    watching: undefined,
  })
  assert.equal(
    sessionActionGates({ sessionId: 's-4', archived: true, openedAt: 1 }).canArchive,
    false,
  )
  assert.equal(sessionActionGates(undefined).saved, false)
})

test('watching is reported only for a saved chat', () => {
  assert.equal(
    sessionActionGates({ sessionId: 's-5', watching: false, openedAt: 1 }).watching,
    false,
  )
  assert.equal(
    sessionActionGates({ sessionId: 's-5', foreign: true, watching: true, openedAt: 1 }).watching,
    true,
  )
  assert.equal(
    sessionActionGates({ sessionId: 'fork-2', unsaved: true, watching: true }).watching,
    undefined,
  )
})

test('a new chat reads its model settings only once the server has its conversation', () => {
  const asked = { id: 'u', role: 'user' as const, parts: [] }
  const answered = { id: 'a', role: 'assistant' as const, parts: [] }

  // Sent, but the stream has not started: the conversation may not exist yet.
  assert.equal(serverHasConversation({ connected: false, messages: [asked] }), false)
  // The stream started, so the backend stored the conversation.
  assert.equal(serverHasConversation({ connected: true, messages: [asked] }), true)
  // A later turn reconnects, but a reply proves the conversation exists.
  assert.equal(serverHasConversation({ connected: false, messages: [asked, answered] }), true)
})

test('an unsaved fork has no stored conversation to read settings from', () => {
  const answered = { id: 'a', role: 'assistant' as const, parts: [] }

  assert.equal(
    serverHasConversation({ connected: true, messages: [answered], unsaved: true }),
    false,
  )
})

test('a new chat offers its session actions only once the server has it', () => {
  const asked = { id: 'u', role: 'user' as const, parts: [] }
  const answered = { id: 'a', role: 'assistant' as const, parts: [] }

  // Sent, but the backend has not answered: participants and the menu would 404.
  assert.equal(
    sessionActionGates({ sessionId: 'new-1', connected: false, messages: [asked] }).saved,
    false,
  )
  // The backend stores a new chat before its first frame.
  assert.equal(
    sessionActionGates({ sessionId: 'new-1', connected: true, messages: [asked] }).saved,
    true,
  )
  // Between turns the reply on record keeps it saved.
  assert.equal(
    sessionActionGates({ sessionId: 'new-1', connected: false, messages: [asked, answered] }).saved,
    true,
  )
})

test('a chat opened from the server is saved even with no reply on record', () => {
  const asked = { id: 'u', role: 'user' as const, parts: [] }

  assert.equal(
    sessionActionGates({ sessionId: 'old-1', openedAt: 1, connected: false, messages: [asked] })
      .saved,
    true,
  )
  assert.equal(serverHasConversation({ openedAt: 1, connected: false, messages: [asked] }), true)
})

test('an unsaved fork stays unsaved however it was opened', () => {
  assert.equal(
    sessionActionGates({ sessionId: 'fork-3', unsaved: true, openedAt: 1, connected: true }).saved,
    false,
  )
})
