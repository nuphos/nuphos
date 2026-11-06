import { clsx } from 'clsx'
import { useState } from 'react'

import { t } from '../../../i18n'

import { fileDropHandlers } from './fileDrop'

import type { ReactNode } from 'react'

/**
 * Whole-pane drop affordance — a light, transparent tint with a small pill,
 * Codex-style. pointer-events-none so drag/drop keeps firing on the container
 * underneath.
 */
export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] bg-action-primary/[0.06] ring-1 ring-inset ring-line-focus">
      <span className="rounded-full border border-action-primary/30 bg-elevated/90 px-3 py-1 text-[12px] font-medium text-primary shadow-sm backdrop-blur-sm">
        {t('Drop to attach')}
      </span>
    </div>
  )
}

/** A pane that attaches files dropped anywhere on it to its composer (`target`). */
export function FileDropZone({
  target,
  className,
  children,
}: {
  target: { current: ((dt: DataTransfer) => void) | null }
  className?: string
  children: ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  // Nested dragenter/leave count; a plain holder, never rendered.
  const [depth] = useState(() => ({ current: 0 }))

  return (
    <div
      {...fileDropHandlers({ target: () => target.current, depth, setDragging })}
      className={clsx('relative', className)}
    >
      {children}
      {dragging && <DropOverlay />}
    </div>
  )
}
