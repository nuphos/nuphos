import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n/index.ts'
import { composerTextState } from '../../../lib/composerTextState'
import { cssDurationMs } from '../../../lib/motion'

import { isImageAttachmentPath } from './attachments'
import { focusAtEnd, readEditorText, renumberImageRefs } from './composerSerialize'
import { AGENT_COMPACT_PLACEHOLDER, AGENT_PLACEHOLDER_PROMPTS } from './constants'

import type { LocalAgentSessionInfo, LocalSessionSource } from '../../../api'

export type ComposerState = ReturnType<typeof useComposerState>

export function useComposerState({
  hero,
  readOnly,
  readOnlyPlaceholder,
  streaming,
  autoFocus,
  focusKey,
  promptSuggestion,
}: {
  hero: boolean
  readOnly: boolean
  readOnlyPlaceholder?: string
  streaming: boolean
  autoFocus: boolean
  /** The conversation shown; switching to another one takes the caret even mid-reply or with a draft. */
  focusKey?: string
  promptSuggestion?: string | null
}) {
  // One suggestion per composer mount, picked at random. Rotating it moved the
  // sentence out from under whoever was reading it; pinning it to the first
  // prompt turned it into furniture nobody sees after a week.
  const placeholderPool = AGENT_PLACEHOLDER_PROMPTS
  const [placeholderIndex] = useState(
    () => crypto.getRandomValues(new Uint32Array(1))[0] % placeholderPool.length,
  )
  const suggestedPrompt =
    promptSuggestion || placeholderPool[placeholderIndex % placeholderPool.length]
  // A conversation offers the runtime's own guess; the hero offers an example.
  const offersSuggestion = hero || Boolean(promptSuggestion)
  const idlePlaceholder = offersSuggestion ? suggestedPrompt : AGENT_COMPACT_PLACEHOLDER
  const [filePaths, setFilePaths] = useState<string[]>([])
  // Paths picked as directories (vs single files). Tracked alongside `filePaths`
  // purely so the attachment chip can show a folder icon — the underlying send
  // payload stays a flat `string[]`.
  const [folderPaths, setFolderPaths] = useState<Set<string>>(() => new Set())
  // Data-URL previews for image attachments so the composer shows a thumbnail
  // instead of a generic chip. Keyed by path; loaded lazily.
  const [imageThumbs, setImageThumbs] = useState<Record<string, string>>({})

  useEffect(() => {
    const missing = filePaths.filter((p) => isImageAttachmentPath(p) && !(p in imageThumbs))

    if (missing.length === 0) return
    let cancelled = false

    void (async () => {
      for (const p of missing) {
        try {
          const img = await api.readImageAttachment(p)

          if (cancelled || !img) continue
          setImageThumbs((prev) => ({ ...prev, [p]: img.url }))
        } catch {
          // Ignore — a failed preview just falls back to the placeholder icon.
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePaths, imageThumbs])
  // A contenteditable editor has two kinds of "empty":
  //
  // - `hasEditorContent` is visual. Any character, including a space, means the
  //   user has started typing and the ghost placeholder must get out of the way.
  // - `isEmpty` is semantic. Whitespace is still not a message, so send remains
  //   disabled and parent empty-state behavior remains unchanged.
  //
  // The editor's DOM is the source of truth — we don't try to round-trip a
  // `value` prop because contenteditable doesn't behave like a controlled input.
  const [hasEditorContent, setHasEditorContent] = useState(false)
  const [isEmpty, setIsEmpty] = useState(true)

  const canCompleteSuggestion = offersSuggestion && !hasEditorContent && !readOnly && !streaming
  const ref = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  const editListenerRef = useRef<(() => void) | null>(null)
  const lastSeenSeedNonce = useRef<number | null>(null)
  const placeholderRef = useRef<HTMLSpanElement>(null)
  const placeholderSwapTimerRef = useRef<number | null>(null)
  const displayedPlaceholderRef = useRef<string>(idlePlaceholder)
  const [displayedPlaceholder, setDisplayedPlaceholder] = useState<string>(idlePlaceholder)
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [localSessionsBySource, setLocalSessionsBySource] = useState<
    Partial<Record<LocalSessionSource, LocalAgentSessionInfo[]>>
  >({})
  const [localSessionsLoading, setLocalSessionsLoading] = useState<
    Partial<Record<LocalSessionSource, boolean>>
  >({})
  const [localSessionsError, setLocalSessionsError] = useState<
    Partial<Record<LocalSessionSource, string>>
  >({})

  function readText(): string {
    return readEditorText(ref.current)
  }

  function syncEmpty() {
    const text = readText()

    // Chromium leaves a <br> behind once everything is deleted. The text is
    // empty, so make the DOM empty too; otherwise the next insertion (a Tab
    // suggestion, a slash command) lands after that <br>, on a second line.
    if (!text && !composingRef.current) ref.current?.replaceChildren()
    const state = composerTextState(text)

    setHasEditorContent(state.hasContent)
    setIsEmpty(!state.canSendText)
    editListenerRef.current?.()
  }

  function clearEditor() {
    if (ref.current) ref.current.innerHTML = ''
    setHasEditorContent(false)
    setIsEmpty(true)
    editListenerRef.current?.()
  }

  function removeAttachment(filePath: string) {
    const image = filePaths.filter(isImageAttachmentPath).indexOf(filePath) + 1

    if (image > 0 && ref.current) {
      renumberImageRefs(ref.current, image)
      syncEmpty()
    }
    setFilePaths((prev) => prev.filter((path) => path !== filePath))
    setFolderPaths((prev) => {
      if (!prev.has(filePath)) return prev
      const next = new Set(prev)

      next.delete(filePath)

      return next
    })
    setImageThumbs((prev) => {
      if (!(filePath in prev)) return prev
      const next = { ...prev }

      delete next[filePath]

      return next
    })
  }

  function onCompositionStart() {
    composingRef.current = true
  }

  function onCompositionEnd() {
    composingRef.current = false
    syncEmpty()
  }

  function seedAlreadySeen(nonce: number) {
    if (lastSeenSeedNonce.current === nonce) return true
    lastSeenSeedNonce.current = nonce

    return false
  }

  const swapPlaceholder = useCallback((next: string) => {
    if (displayedPlaceholderRef.current === next) return
    if (placeholderSwapTimerRef.current !== null) {
      window.clearTimeout(placeholderSwapTimerRef.current)
      placeholderSwapTimerRef.current = null
    }

    const el = placeholderRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!el || reduced) {
      displayedPlaceholderRef.current = next
      setDisplayedPlaceholder(next)

      return
    }

    const dur = cssDurationMs('--text-swap-dur', 150)

    el.classList.add('is-exit')
    placeholderSwapTimerRef.current = window.setTimeout(() => {
      displayedPlaceholderRef.current = next
      setDisplayedPlaceholder(next)
      el.classList.remove('is-exit')
      el.classList.add('is-enter-start')
      el.getBoundingClientRect() // force the reflow that starts the enter transition
      el.classList.remove('is-enter-start')
      placeholderSwapTimerRef.current = null
    }, dur)
  }, [])

  useEffect(() => {
    return () => {
      if (placeholderSwapTimerRef.current !== null) {
        window.clearTimeout(placeholderSwapTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!autoFocus || readOnly || streaming || !isEmpty) return
    const frame = window.requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus, isEmpty, readOnly, streaming])

  useEffect(() => {
    if (!autoFocus || readOnly) return
    // After the draft restore, so typing continues the draft rather than prefixing it.
    const frame = window.requestAnimationFrame(() => {
      if (ref.current) focusAtEnd(ref.current)
    })

    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  useEffect(() => {
    const next = readOnly
      ? (readOnlyPlaceholder ?? t('This agent is read-only'))
      : streaming
        ? t('Agent is replying...')
        : idlePlaceholder

    swapPlaceholder(next)
  }, [idlePlaceholder, readOnly, readOnlyPlaceholder, streaming, swapPlaceholder])

  return {
    suggestedPrompt,
    filePaths,
    setFilePaths,
    folderPaths,
    setFolderPaths,
    imageThumbs,
    setImageThumbs,
    hasEditorContent,
    isEmpty,
    canCompleteSuggestion,
    ref,
    composingRef,
    editListenerRef,
    placeholderRef,
    displayedPlaceholder,
    attachmentMenuOpen,
    setAttachmentMenuOpen,
    localSessionsBySource,
    setLocalSessionsBySource,
    localSessionsLoading,
    setLocalSessionsLoading,
    localSessionsError,
    setLocalSessionsError,
    readText,
    syncEmpty,
    clearEditor,
    onCompositionStart,
    removeAttachment,
    onCompositionEnd,
    seedAlreadySeen,
  }
}
