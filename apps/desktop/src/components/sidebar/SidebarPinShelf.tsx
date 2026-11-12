import { useLayoutEffect, useRef, useState } from 'react'

import type { ReactNode } from 'react'

/** Measure the shelf so adding a row and opening/closing share one flow animation. */
export function SidebarPinShelf({ open, children }: { open: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const content = inner.current

    if (!content) return
    // scrollHeight includes pins temporarily translated beyond the grid by FLIP.
    const measure = () => setHeight(open ? content.offsetHeight : 0)
    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(content)

    return () => observer.disconnect()
  }, [open])

  return (
    <div
      className="sidebar-pin-shelf shrink-0"
      style={{ height }}
      aria-hidden={!open}
      inert={!open}
    >
      <div ref={inner} className="pb-3">
        {children}
      </div>
    </div>
  )
}
