import { useCallback, useEffect } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import {
  handleComposerPasteText,
  insertMentionIntoEditor,
  insertTextIntoEditor,
  saveClipboardAttachments,
} from './composerSerialize'

import type { AgentPromptSeed } from './model'
import type { ComposerState } from './useComposerState'
import type { LocalAgentSessionInfo, LocalSessionSource } from '../../../api'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function useComposerActions(
  state: ComposerState,
  {
    readOnly,
    sendBlocked = false,
    streaming,
    onSend,
    pendingSeed,
    onSeedConsumed,
    dropRegisterRef,
  }: {
    readOnly: boolean
    sendBlocked?: boolean
    streaming: boolean
    onSend: (text: string, filePaths: string[]) => void
    pendingSeed?: AgentPromptSeed | null
    onSeedConsumed?: () => void
    dropRegisterRef?: { current: ((dt: DataTransfer) => void) | null }
  },
) {
  function insertMention(url: string, opts?: { appendToEnd?: boolean }) {
    const el = state.ref.current

    if (!el) return
    insertMentionIntoEditor(el, url, opts)
    state.syncEmpty()
  }

  function insertText(text: string, opts?: { appendToEnd?: boolean }) {
    const el = state.ref.current

    if (!el || !text) return
    insertTextIntoEditor(el, text, opts)
    state.syncEmpty()
  }

  // ------------------------------------------------------------------------
  // Effects: seed the editor when a row link is "Open in chat"'d.
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (!pendingSeed) return
    if (readOnly) return
    if (pendingSeed.autoSend && (streaming || sendBlocked)) return
    if (state.seedAlreadySeen(pendingSeed.nonce)) return
    requestAnimationFrame(() => {
      const seedFiles = pendingSeed.filePaths ?? []

      if (pendingSeed.autoSend) {
        onSend(pendingSeed.text, seedFiles)
        state.clearEditor()
        state.setFilePaths([])
        state.setFolderPaths(new Set())
        onSeedConsumed?.()

        return
      }
      if (pendingSeed.replace) {
        state.clearEditor()
      }
      if (seedFiles.length > 0) {
        state.setFilePaths((prev) => Array.from(new Set([...prev, ...seedFiles])))
      }
      if (pendingSeed.text) {
        if (pendingSeed.mode === 'mention') {
          insertMention(pendingSeed.text, { appendToEnd: true })
        } else {
          insertText(pendingSeed.text, { appendToEnd: true })
        }
      }
      onSeedConsumed?.()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed, readOnly, streaming, sendBlocked])

  function submit() {
    if (readOnly || sendBlocked) return
    if (state.composingRef.current) return
    const v = state.readText().trim()

    if (!v && state.filePaths.length === 0) return
    onSend(v, state.filePaths)
    state.clearEditor()
    state.setFilePaths([])
    state.setFolderPaths(new Set())
  }

  async function selectFile() {
    if (readOnly) return
    try {
      const nextPaths = await api.selectLocalFile()

      if (nextPaths.length === 0) return
      state.setFilePaths((prev) => Array.from(new Set([...prev, ...nextPaths])))
    } catch {
      toast.error('Could not open file picker')
    }
  }

  function selectAttachment() {
    state.setAttachmentMenuOpen(false)
    void selectFile()
  }

  async function selectFolder() {
    // Match selectFile: attachments can be picked while a turn streams and are
    // queued for the next send — don't silently no-op when streaming.
    if (readOnly) return
    try {
      const nextPaths = await api.selectLocalFolder()

      if (nextPaths.length === 0) return
      state.setFilePaths((prev) => Array.from(new Set([...prev, ...nextPaths])))
      state.setFolderPaths((prev) => new Set([...prev, ...nextPaths]))
    } catch (err) {
      toast.apiError('Could not open folder picker', err)
    }
  }

  function selectFolderAttachment() {
    state.setAttachmentMenuOpen(false)
    void selectFolder()
  }

  function attachSession(session: LocalAgentSessionInfo) {
    if (readOnly) return
    state.setAttachmentMenuOpen(false)
    state.setFilePaths((prev) => Array.from(new Set([...prev, session.path])))
  }

  const ensureLocalSessions = useCallback(
    (source: LocalSessionSource) => {
      if (state.localSessionsLoading[source]) return
      state.setLocalSessionsLoading((prev) => ({ ...prev, [source]: true }))
      state.setLocalSessionsError((prev) => ({ ...prev, [source]: undefined }))
      api
        .listLocalAgentSessions(source)
        .then((sessions) => {
          state.setLocalSessionsBySource((prev) => ({ ...prev, [source]: sessions }))
        })
        .catch((err: unknown) => {
          state.setLocalSessionsError((prev) => ({
            ...prev,
            [source]: err instanceof Error ? err.message : String(err),
          }))
        })
        .finally(() => {
          state.setLocalSessionsLoading((prev) => ({ ...prev, [source]: false }))
        })
    },
    [state],
  )

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const native = e.nativeEvent as globalThis.KeyboardEvent & {
      keyCode?: number
    }

    // Tab drops the whole suggestion in. It is an example prompt rather than a
    // prefix of what you were typing, so there is nothing to complete word by
    // word — and only while the box is still empty, or Tab would stop being the
    // key that leaves the composer.
    if (state.canCompleteSuggestion && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      insertText(state.suggestedPrompt, { appendToEnd: true })

      return
    }
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !readOnly &&
      !state.composingRef.current &&
      !native.isComposing &&
      native.keyCode !== 229
    ) {
      // While streaming this queues the message (handled by the parent's
      // onSend); when idle it sends immediately.
      e.preventDefault()
      submit()
    }
  }

  // Append attachments and mark which are directories so the chip
  // shows a folder icon + "FOLDER" type instead of "FILE". Pickers set
  // folderPaths directly; pasted/dropped paths don't know their kind, so we ask
  // the main process to stat them.
  function attachPaths(paths: string[]) {
    if (paths.length === 0) return
    state.setFilePaths((prev) => Array.from(new Set([...prev, ...paths])))
    void api
      .attachmentDirectoryPaths(paths)
      .then((dirs) => {
        if (dirs.length > 0) state.setFolderPaths((prev) => new Set([...prev, ...dirs]))
      })
      .catch(() => {
        // Non-fatal — the attachment is still usable, just labeled as a file.
      })
  }

  // Publish an "attach these dropped files" handler so the panel-level drop zone
  // can route a drop here. A drop's DataTransfer is the same shape as
  // a paste's, so we reuse saveClipboardAttachments — local Finder drops carry a
  // path; anything else saves via bytes. Every attachment uploads through the
  // transfer store at send time. null while read-only so the panel no-ops.
  useEffect(() => {
    if (!dropRegisterRef) return
    const handler = readOnly
      ? null
      : (dt: DataTransfer) => {
          void saveClipboardAttachments(dt)
            .then(attachPaths)
            .catch((err: unknown) => {
              toast.apiError('Could not attach files', err)
            })
        }

    dropRegisterRef.current = handler

    return () => {
      if (dropRegisterRef.current === handler) dropRegisterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropRegisterRef, readOnly])

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (readOnly) {
      e.preventDefault()

      return
    }
    if (
      e.clipboardData.files.length > 0 ||
      Array.from(e.clipboardData.items).some((item) => item.kind === 'file')
    ) {
      e.preventDefault()
      void saveClipboardAttachments(e.clipboardData)
        .then(attachPaths)
        .catch((err: unknown) => {
          toast.apiError('Could not attach files', err)
        })

      return
    }

    const raw = e.clipboardData.getData('text/plain')

    if (!raw) return
    e.preventDefault()
    handleComposerPasteText(raw, insertMention)
    state.syncEmpty()
  }

  return {
    submit,
    selectAttachment,
    selectFolderAttachment,
    attachSession,
    ensureLocalSessions,
    onKeyDown,
    onPaste,
  }
}
