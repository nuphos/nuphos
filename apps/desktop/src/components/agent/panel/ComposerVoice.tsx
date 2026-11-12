import { useEffect } from 'react'

import { isMac } from '../../../lib/platform'

import { ComposerVoiceButton } from './ComposerVoiceButton'
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

/** The composer's voice input: the microphone button, and mod+shift+U in the editor. */
export function ComposerVoice({ editor, teamId, hero }: ComposerVoiceScope & { hero: boolean }) {
  const voice = useVoiceDictation({
    teamId,
    onText: (text) => {
      if (editor.current) insertAtCaret(editor.current, text)
    },
  })
  const { toggle } = voice

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

  if (!voice.available) return null

  return (
    <ComposerVoiceButton
      phase={voice.phase}
      elapsedMs={voice.elapsedMs}
      hero={hero}
      onStart={() => void voice.start()}
      onStop={voice.stop}
      onCancel={voice.cancel}
    />
  )
}
