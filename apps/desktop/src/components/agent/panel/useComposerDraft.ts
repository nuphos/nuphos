import { useEffect, useLayoutEffect, useRef } from 'react'

import { loadComposerDraft, saveComposerDraft } from './composerDrafts'
import { restoreEditorText } from './composerSerialize'

import type { ComposerDraft } from './composerDrafts'
import type { ComposerState } from './useComposerState'

const SAVE_DELAY_MS = 250

/** Keep the unsent text and attachments of each conversation's composer across switches and reloads. */
export function useComposerDraft(state: ComposerState, draftKey: string | undefined) {
  const {
    editListenerRef,
    filePaths,
    folderPaths,
    readText,
    ref,
    setFilePaths,
    setFolderPaths,
    syncEmpty,
  } = state
  const pending = useRef<{ key: string; draft: ComposerDraft } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const restoredFiles = useRef<string[] | null>(null)
  const activeKey = useRef<string | undefined>(undefined)
  const loadedOnce = useRef(false)

  function flush() {
    window.clearTimeout(timer.current)
    if (pending.current) saveComposerDraft(pending.current.key, pending.current.draft)
    pending.current = null
  }

  function record() {
    const key = activeKey.current

    if (!key || !ref.current) return
    pending.current = {
      key,
      draft: {
        text: readText(),
        filePaths: restoredFiles.current ?? filePaths,
        folderPaths: [...folderPaths],
      },
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
  }

  useLayoutEffect(() => {
    editListenerRef.current = record
  })

  useEffect(() => {
    const el = ref.current

    if (!draftKey || !el) return
    const switched = loadedOnce.current
    const draft = loadComposerDraft(draftKey)

    loadedOnce.current = true
    activeKey.current = draftKey
    if (switched || draft) {
      restoreEditorText(el, draft?.text ?? '')
      restoredFiles.current = draft?.filePaths.length ? draft.filePaths : null
      setFilePaths(draft?.filePaths ?? [])
      setFolderPaths(new Set(draft?.folderPaths ?? []))
      syncEmpty()
    }

    return () => {
      flush()
      activeKey.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  useEffect(() => {
    if (restoredFiles.current) {
      if (filePaths !== restoredFiles.current) return
      restoredFiles.current = null
    }
    record()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePaths, folderPaths])
}
