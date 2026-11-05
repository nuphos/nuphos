import assert from 'node:assert/strict'
import test from 'node:test'

import {
  claimComposerDrafts,
  clearComposerDrafts,
  composerDraftKey,
  loadComposerDraft,
  newChatDraftKey,
  saveComposerDraft,
} from './composerDrafts.ts'

function memoryStorage() {
  const values = new Map<string, string>()

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

const draft = (text: string, filePaths: string[] = []) => ({ text, filePaths, folderPaths: [] })

test('switching to another conversation and back restores the unsent draft', () => {
  const storage = memoryStorage()
  const a = composerDraftKey('team-1', 'session-a')
  const b = composerDraftKey('team-1', 'session-b')

  claimComposerDrafts('user-1', storage)
  saveComposerDraft(a, draft('half-written question', ['/Users/me/log.txt']), storage)
  assert.equal(loadComposerDraft(b, storage), null)
  saveComposerDraft(b, draft('something else'), storage)

  assert.deepEqual(
    loadComposerDraft(a, storage),
    draft('half-written question', ['/Users/me/log.txt']),
  )
  assert.deepEqual(loadComposerDraft(b, storage), draft('something else'))
})

test('sending clears the draft so it never comes back', () => {
  const storage = memoryStorage()
  const key = composerDraftKey('team-1', 'session-a')

  claimComposerDrafts('user-1', storage)
  saveComposerDraft(key, draft('send me'), storage)
  saveComposerDraft(key, draft('   '), storage)

  assert.equal(loadComposerDraft(key, storage), null)
})

test('the new-conversation draft is per team', () => {
  const storage = memoryStorage()

  claimComposerDrafts('user-1', storage)
  saveComposerDraft(newChatDraftKey('team-1', 'primary'), draft('for team one'), storage)

  assert.equal(loadComposerDraft(newChatDraftKey('team-2', 'primary'), storage), null)
  assert.equal(
    loadComposerDraft(newChatDraftKey('team-1', 'primary'), storage)?.text,
    'for team one',
  )
})

test('a split pane or new tab starts its new chat empty and the original keeps its draft', () => {
  const storage = memoryStorage()
  const primary = newChatDraftKey('team-1', 'primary')

  claimComposerDrafts('user-1', storage)
  saveComposerDraft(primary, draft('h'), storage)

  assert.equal(loadComposerDraft(newChatDraftKey('team-1', 'pane-2'), storage), null)
  assert.equal(loadComposerDraft(newChatDraftKey('team-1', 'tab:t1'), storage), null)
  saveComposerDraft(newChatDraftKey('team-1', 'pane-2'), draft('other pane'), storage)
  assert.equal(loadComposerDraft(primary, storage)?.text, 'h')
})

test('the first pane still finds the new-chat draft saved before panes had their own', () => {
  const storage = memoryStorage()

  claimComposerDrafts('user-1', storage)
  saveComposerDraft('team-1:new', draft('saved by an older version'), storage)

  assert.equal(
    loadComposerDraft(newChatDraftKey('team-1', 'primary'), storage)?.text,
    'saved by an older version',
  )
})

test('drafts never reach another account', () => {
  const storage = memoryStorage()
  const key = composerDraftKey('team-1', 'session-a')

  claimComposerDrafts('user-1', storage)
  saveComposerDraft(key, draft('private'), storage)
  claimComposerDrafts('user-1', storage)
  assert.equal(loadComposerDraft(key, storage)?.text, 'private')

  claimComposerDrafts('user-2', storage)
  assert.equal(loadComposerDraft(key, storage), null)

  claimComposerDrafts('user-1', storage)
  saveComposerDraft(key, draft('again'), storage)
  clearComposerDrafts(storage)
  assert.equal(loadComposerDraft(key, storage), null)
  saveComposerDraft(key, draft('unowned'), storage)
  assert.equal(loadComposerDraft(key, storage), null)
})

test('only the most recent drafts are kept and broken storage is ignored', () => {
  const storage = memoryStorage()

  claimComposerDrafts('user-1', storage)
  for (let index = 0; index < 60; index++) {
    saveComposerDraft(composerDraftKey('t', `s${String(index)}`), draft('x'), storage, index)
  }
  assert.equal(loadComposerDraft(composerDraftKey('t', 's0'), storage), null)
  assert.equal(loadComposerDraft(composerDraftKey('t', 's59'), storage)?.text, 'x')

  storage.setItem('nuphos.agent.composerDrafts.v1', '{not json')
  assert.equal(loadComposerDraft(composerDraftKey('t', 's59'), storage), null)

  const throwing = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }

  assert.doesNotThrow(() => claimComposerDrafts('user-1', throwing))
  assert.doesNotThrow(() => saveComposerDraft('k', draft('x'), throwing))
  assert.equal(loadComposerDraft('k', throwing), null)
})

test('a draft too long to store is kept whole for the session, never cut short', () => {
  const storage = memoryStorage()
  const key = composerDraftKey('team-1', 'session-a')
  const long = 'x'.repeat(150_000)

  claimComposerDrafts('user-1', storage)
  saveComposerDraft(key, draft('short'), storage)
  saveComposerDraft(key, draft(long), storage)

  assert.equal(loadComposerDraft(key, storage)?.text, long)
  assert.ok(!storage.getItem('nuphos.agent.composerDrafts.v1')?.includes('short'))
  saveComposerDraft(key, draft(''), storage)
  assert.equal(loadComposerDraft(key, storage), null)
})
