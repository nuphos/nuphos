import clsx from 'clsx'

import { useDropTarget } from './chat-drag'

import type { DropPosition } from './chat-drag'
import type { ReactNode } from 'react'

/** The insertion line shown while a drag would land before or after a row. */
export function DropLine({ position }: { position: DropPosition | null }) {
  if (position !== 'before' && position !== 'after') return null

  return (
    <span
      aria-hidden
      className={clsx(
        'pointer-events-none absolute left-2 right-2 z-10 h-0.5 rounded-full bg-zViolet-500',
        position === 'before' ? '-top-px' : '-bottom-px',
      )}
    />
  )
}

/** A chat row that a dragged chat can be dropped above or below. */
export function ReorderZone({
  sessionId,
  onDrop,
  children,
}: {
  sessionId: string
  onDrop: (dragged: string, target: string, position: 'before' | 'after') => void
  children: ReactNode
}) {
  const drop = useDropTarget({
    kind: 'chat',
    sided: true,
    accepts: (dragged) => dragged !== sessionId,
    onDrop: (dragged, position) => {
      if (position !== 'inside') onDrop(dragged, sessionId, position)
    },
  })

  return (
    <div {...drop.props} className="relative">
      {children}
      <DropLine position={drop.over} />
    </div>
  )
}
