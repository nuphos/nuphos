import { useEffect, useRef } from 'react'

import { caretAtEdge, historyStep, IDLE_CURSOR, recallKey } from './composerRecall'
import { focusAtEnd, restoreEditorText, serializeNode } from './composerSerialize'

import type { ComposerRecall } from './composerRecall'
import type { ComposerState } from './useComposerState'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Replace the composer's content, caret at the end. */
function replaceDraft(state: ComposerState, text: string, filePaths: string[] = []) {
  const el = state.ref.current

  if (!el) return
  restoreEditorText(el, text)
  if (filePaths.length > 0)
    state.setFilePaths((prev) => Array.from(new Set([...prev, ...filePaths])))
  state.syncEmpty()
  focusAtEnd(el)
}

/** The editor's text on each side of the caret, or null with no caret in it. */
function textAroundCaret(el: HTMLDivElement | null): [string, string] | null {
  const selection = window.getSelection()

  if (!el || !selection?.rangeCount) return null
  const caret = selection.getRangeAt(0)

  if (!el.contains(caret.startContainer) || !el.contains(caret.endContainer)) return null
  const side = (setEdge: (range: Range) => void) => {
    const range = document.createRange()
    const holder = document.createElement('span')

    range.selectNodeContents(el)
    setEdge(range)
    holder.append(range.cloneContents())

    return serializeNode(holder)
  }

  return [
    side((range) => range.setEnd(caret.startContainer, caret.startOffset)).replace(/^\n+/, ''),
    side((range) => range.setStart(caret.endContainer, caret.endOffset)),
  ]
}

/** Esc takes back a just-sent message; Up/Down walk your sent messages. */
export function useComposerRecall(
  state: ComposerState,
  readOnly: boolean,
  recall: ComposerRecall | undefined,
) {
  const cursor = useRef(IDLE_CURSOR)
  const history = recall?.history
  const sent = history?.length ?? 0

  // A new send starts browsing over from the newest message.
  useEffect(() => {
    cursor.current = IDLE_CURSOR
  }, [sent])

  /** True when the key was a recall and is handled. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): boolean {
    const native = e.nativeEvent as globalThis.KeyboardEvent & { keyCode?: number }
    const key =
      recall && !readOnly
        ? recallKey({
            key: e.key,
            composing: state.composingRef.current || native.isComposing || native.keyCode === 229,
            modified: e.shiftKey || e.altKey || e.metaKey || e.ctrlKey,
          })
        : null

    // Any other key that edits ends browsing; the text is now your own draft.
    if (!key && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete'))
      cursor.current = IDLE_CURSOR
    if (!recall || !key) return false
    if (key === 'retract') {
      // Only an empty composer, so a draft is never swapped out. With nothing
      // to take back, Esc falls through to stopping the turn.
      const retracted = state.isEmpty && state.filePaths.length === 0 ? recall.retract() : null

      if (!retracted) return false
      e.preventDefault()
      void retracted.then((draft) => {
        // Typed into meanwhile: what you typed wins.
        if (draft && !state.readText().trim()) replaceDraft(state, draft.text, draft.filePaths)
      })

      return true
    }
    const around = textAroundCaret(state.ref.current)
    const step =
      around && caretAtEdge(around[0], around[1], key, cursor.current.index !== null)
        ? historyStep(cursor.current, key, recall.history, state.readText())
        : null

    if (!step) return false
    e.preventDefault()
    cursor.current = step.cursor
    replaceDraft(state, step.text)

    return true
  }

  return { onKeyDown }
}
