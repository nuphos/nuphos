import clsx from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'

/**
 * A question as its card's title: one line, cut with an ellipsis. A cut one
 * shows in full on hover, and stays open in full once clicked, so a long
 * question asked before the one-line limit loses nothing.
 */
export function DecisionTitle({
  as: Tag = 'h3',
  className,
  children,
}: {
  as?: 'h1' | 'h3'
  className?: string
  children: string
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const [cut, setCut] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current

    if (el && !open) setCut(el.scrollWidth > el.clientWidth + 1)
  }, [children, open])

  return (
    <Tag
      ref={ref}
      title={cut && !open ? children : undefined}
      onClick={cut && !open ? () => setOpen(true) : undefined}
      className={clsx(
        'selectable',
        open ? 'whitespace-pre-wrap break-words' : 'truncate',
        cut && !open && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
