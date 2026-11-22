import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { ComposerState } from './useComposerState'

// Effects run as the hook mounts, and refs are plain objects: one mount is all this covers.
mock.module('react', {
  namedExports: {
    useEffect: (effect: () => void) => {
      effect()
    },
    useLayoutEffect: (effect: () => void) => {
      effect()
    },
    useRef: <T>(current: T) => ({ current }),
  },
})
mock.module('./composerSerialize.ts', { namedExports: { restoreEditorText: () => {} } })
mock.module('./attachments.ts', { namedExports: { isImageAttachmentPath: () => false } })

const items = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
Object.assign(globalThis.window, { setTimeout, clearTimeout })

const { claimComposerDrafts, loadComposerDraft } = await import('./composerDrafts.ts')
const { useComposerDraft } = await import('./useComposerDraft.ts')

test('a reload right after an edit keeps that edit, not the draft saved before it', () => {
  let text = ''
  const editListenerRef: { current: (() => void) | null } = { current: null }
  const state = {
    editListenerRef,
    filePaths: [],
    folderPaths: new Set<string>(),
    readText: () => text,
    ref: { current: {} },
    setFilePaths: () => {},
    setFolderPaths: () => {},
    syncEmpty: () => {},
  } as unknown as ComposerState

  claimComposerDrafts('user')
  useComposerDraft(state, 'team:session')
  text = '/e2e'
  editListenerRef.current!()
  window.dispatchEvent(new Event('pagehide'))
  assert.equal(loadComposerDraft('team:session')?.text, '/e2e')

  // Cleared, then the page goes away before the save delay is up.
  text = ''
  editListenerRef.current!()
  window.dispatchEvent(new Event('pagehide'))
  assert.equal(loadComposerDraft('team:session'), null)
})
