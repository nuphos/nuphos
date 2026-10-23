import { useEffect } from 'react'

import { composerOf } from './modelSelectorParts'
import { transcriptPageStep } from './transcriptKeys'

import type { RefObject } from 'react'

/**
 * PageUp / PageDown page the transcript of the panel holding focus. With focus
 * on <body> the browser already pages whatever was clicked last. Paging up
 * holds the reader in history like a wheel scroll; the bottom resumes following.
 */
export function useTranscriptPageKeys(
  ref: RefObject<HTMLElement | null>,
  lockScrollToHistory: () => void,
  handleUserScrollIntent: () => void,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const el = ref.current
      const step = transcriptPageStep(event)

      const active = document.activeElement

      if (!el || step === null || !active || !composerOf(el)?.contains(active)) return
      event.preventDefault()
      if (step < 0) lockScrollToHistory()
      else handleUserScrollIntent()
      el.scrollBy({ top: step * el.clientHeight * 0.85 })
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ref, lockScrollToHistory, handleUserScrollIntent])
}
