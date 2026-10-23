import { useEffect } from 'react'

import { composerOf } from './modelSelectorParts'
import { transcriptPageStep } from './transcriptKeys'

import type { RefObject } from 'react'

const TRANSCRIPT = '[data-transcript]'

/**
 * PageUp / PageDown page the transcript of the panel holding focus, or of the
 * only one on screen when focus is on <body>. Paging up holds the reader in
 * history like a wheel scroll; reaching the bottom resumes following.
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

      if (!el || step === null || !ownsTranscriptKeys(el)) return
      event.preventDefault()
      if (step < 0) lockScrollToHistory()
      else handleUserScrollIntent()
      el.scrollBy({ top: step * el.clientHeight * 0.85 })
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ref, lockScrollToHistory, handleUserScrollIntent])
}

function ownsTranscriptKeys(el: HTMLElement) {
  const active = document.activeElement

  if (active && active !== document.body) return Boolean(composerOf(el)?.contains(active))

  return (
    [...document.querySelectorAll<HTMLElement>(TRANSCRIPT)].filter((other) =>
      other.checkVisibility(),
    ).length === 1
  )
}
