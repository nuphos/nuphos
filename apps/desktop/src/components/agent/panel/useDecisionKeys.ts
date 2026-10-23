import { useCallback, useEffect, useRef } from 'react'

import { isMac } from '../../../lib/platform'

import { decisionKey, focusedBoxHasText } from './decisionKeys'
import { composerOf, ownsShortcut } from './modelSelectorParts'

import type { DecisionKey } from './decisionKeys'
import type { RefObject } from 'react'

/** Cards mark their root with this while they wait on the user. */
const LIVE_CARD = '[data-decision-card]'

/**
 * Binds the keys of a card waiting on the user while its panel has focus, or
 * while it is the only such card on screen. `act` runs an action and hands the
 * caret back to the composer, since the card's buttons unmount under it.
 */
export function useDecisionKeys(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onKey: (key: DecisionKey) => boolean,
) {
  const latest = useRef(onKey)

  useEffect(() => {
    latest.current = onKey
  })

  const act = useCallback(
    (run: () => unknown) => {
      const box = composerOf(ref.current)?.querySelector<HTMLElement>('[aria-label="Message"]')

      if (run() === false) return false
      window.requestAnimationFrame(() => box?.focus({ preventScroll: true }))

      return true
    },
    [ref],
  )

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const card = ref.current
      const key = decisionKey(event, isMac, focusedBoxHasText(document.activeElement))

      if (!key || event.defaultPrevented || !card || !ownsShortcut(card, LIVE_CARD)) return
      if (!act(() => latest.current(key))) return
      // Capture phase, so the composer's Enter doesn't also send; first live card wins.
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)

    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled, act, ref])

  return act
}
