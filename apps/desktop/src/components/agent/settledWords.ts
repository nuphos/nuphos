import { useCallback, useLayoutEffect, useRef } from 'react'

import type { AnimationEvent } from 'react'

// Streamdown fades each streamed word in with CSS. A CSS animation replays whenever its element
// is shown again, so a reply hidden while another chat was open faded back in from almost white.
const WORD = '[data-sd-animate]'

const settle = (word: Element) => word.removeAttribute('data-sd-animate')

/**
 * A streaming reply's words fade in once, as they arrive: those already there when it is
 * drawn show at once, and a word that has faded in stays drawn.
 */
export function useSettledWords() {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    ref.current?.querySelectorAll(WORD).forEach(settle)
  }, [])
  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.matches(WORD)) settle(event.target)
  }, [])

  return { ref, onAnimationEnd }
}
