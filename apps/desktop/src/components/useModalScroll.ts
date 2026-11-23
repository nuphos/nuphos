import { useLayoutEffect, useState } from 'react'

import type { RefObject, UIEvent } from 'react'

export function useModalScroll(
  open: boolean,
  scrollResetKey: string | undefined,
  bodyRef: RefObject<HTMLDivElement | null>,
) {
  const [bodyScrolled, setBodyScrolled] = useState(false)
  const [scrollOpen, setScrollOpen] = useState(open)
  const [scrollView, setScrollView] = useState(scrollResetKey)

  if (scrollView !== scrollResetKey) {
    setScrollView(scrollResetKey)
    setBodyScrolled(false)
  }

  if (scrollOpen !== open) {
    setScrollOpen(open)
    setBodyScrolled(false)
  }

  useLayoutEffect(() => {
    if (scrollResetKey !== undefined && bodyRef.current) bodyRef.current.scrollTop = 0
  }, [scrollResetKey, bodyRef, open])

  function onScrollCapture(event: UIEvent<HTMLDivElement>) {
    setBodyScrolled((event.target as HTMLElement).scrollTop > 0)
  }

  return { bodyScrolled, onScrollCapture }
}
