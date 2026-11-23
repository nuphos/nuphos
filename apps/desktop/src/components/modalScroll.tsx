import clsx from 'clsx'
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

export function ModalScrollFade({ isLight }: { isLight: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'pointer-events-none absolute inset-x-0 top-full h-5 bg-gradient-to-b to-transparent',
        isLight ? 'from-white' : 'from-surface-sheet',
      )}
    />
  )
}
