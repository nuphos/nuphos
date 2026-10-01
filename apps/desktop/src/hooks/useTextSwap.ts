import { useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

/** transitions.dev "Text states swap" for a `.t-text-swap` element: returns its ref and the text to render. */
export function useTextSwap<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null)
  const shouldReduceMotion = useReducedMotion()
  const [displayText, setDisplayText] = useState(text)
  const displayTextRef = useRef(text)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current

    if (!el || displayTextRef.current === text) return

    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)

    // Nothing to cross-fade: the caller renders `text` straight through, and
    // leaving the ref behind means turning motion back on picks the swap up.
    if (shouldReduceMotion) return

    const dur =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur')) ||
      150

    el.classList.add('is-exit')
    timeoutRef.current = window.setTimeout(() => {
      displayTextRef.current = text
      setDisplayText(text)
      el.classList.remove('is-exit')
      el.classList.add('is-enter-start')
      el.getBoundingClientRect() // force the reflow that starts the enter transition
      el.classList.remove('is-enter-start')
      timeoutRef.current = null
    }, dur)
  }, [text, shouldReduceMotion])

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  return { ref, text: shouldReduceMotion ? text : displayText }
}
