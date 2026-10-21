import clsx from 'clsx'
import { createPortal } from 'react-dom'

import type { ReactNode } from 'react'

/** A step's action row, in a dialog's pinned footer below its scrolling body; nothing until it mounts. */
export function StepActions({
  footer,
  className,
  children,
}: {
  footer: HTMLElement | null
  className: string
  children: ReactNode
}) {
  if (!footer) return null

  return createPortal(<div className={clsx(className, 'px-5 py-3')}>{children}</div>, footer)
}
