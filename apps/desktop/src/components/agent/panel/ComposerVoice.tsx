import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { isMac } from '../../../lib/platform'

import { ComposerVoiceButton } from './ComposerVoiceButton'
import { DictationBar } from './DictationBar'
import { useVoiceDictation } from './useVoiceDictation'
import { dictationInsert, isVoiceShortcut } from './voiceDictation'

import type { RefObject } from 'react'

export type ComposerVoiceScope = { editor: RefObject<HTMLDivElement | null>; teamId?: string }

/** Insert at the caret, or at the end when the caret is not in the editor; as typing would. */
function insertAtCaret(editor: HTMLDivElement, text: string) {
  const selection = window.getSelection()

  editor.focus()
  if (!selection) return
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
    const end = document.createRange()

    end.selectNodeContents(editor)
    end.collapse(false)
    selection.removeAllRanges()
    selection.addRange(end)
  }
  const caret = selection.getRangeAt(0)
  const before = document.createRange()

  before.selectNodeContents(editor)
  before.setEnd(caret.startContainer, caret.startOffset)
  const piece = dictationInsert(text, before.toString())

  // execCommand keeps undo and fires the editor's input handling, like a paste.
  if (piece) document.execCommand('insertText', false, piece)
}

/**
 * The composer's voice input: the microphone button, and mod+shift+U in the editor.
 * A take covers the whole composer with the recording bar, as on iOS: ■ puts the
 * transcript at the caret, and ↑ puts it there and sends, as Enter would.
 */
export function ComposerVoice({
  editor,
  teamId,
  hero,
  onSend,
}: ComposerVoiceScope & { hero: boolean; onSend: () => void }) {
  const voice = useVoiceDictation({
    teamId,
    meter: true,
    onText: (text, { send }) => {
      if (!editor.current) return
      insertAtCaret(editor.current, text)
      if (send) onSend()
    },
  })
  const { toggle } = voice
  const idle = voice.phase.kind === 'idle'
  const took = useRef(false)

  useEffect(() => {
    const el = editor.current

    if (!el || !teamId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isVoiceShortcut(event, isMac)) return
      event.preventDefault()
      event.stopPropagation()
      toggle()
    }

    el.addEventListener('keydown', onKeyDown)

    return () => el.removeEventListener('keydown', onKeyDown)
  }, [editor, teamId, toggle])

  // When a take ends, however it ends, the keyboard goes back to the editor.
  useEffect(() => {
    if (!idle) took.current = true
    else if (took.current) editor.current?.focus()
  }, [idle, editor])

  if (!voice.available) return null
  const surface = editor.current?.closest('.composer-surface')

  return (
    <>
      <ComposerVoiceButton hero={hero} onStart={() => void voice.start()} />
      {!idle &&
        surface &&
        createPortal(
          <div
            className={clsx(
              'absolute inset-0 z-10 flex items-center rounded-[inherit] bg-composer',
              hero ? 'px-5' : 'px-3',
            )}
          >
            <DictationBar
              phase={voice.phase}
              elapsedMs={voice.elapsedMs}
              levels={voice.levels}
              onCancel={voice.cancel}
              onStop={() => voice.stop()}
              onSend={() => voice.stop({ send: true })}
            />
          </div>,
          surface,
        )}
    </>
  )
}
