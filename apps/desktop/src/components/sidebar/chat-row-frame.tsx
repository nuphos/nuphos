import clsx from 'clsx'

import { endDrag, startDrag } from './chat-drag'
import { ReorderZone } from './drop-line'
import { NestedRowBody } from './nest-guides'

import type { ReactNode } from 'react'

type Reorder = (dragged: string, target: string, position: 'before' | 'after') => void

/**
 * A chat row's frame: it collapses out while an archive is in flight, drags
 * as a chat, and, in a project, takes chats dropped above or below it.
 */
export function ChatRowFrame({
  sessionId,
  archiving,
  trail,
  expanded,
  draggable,
  onReorder,
  children,
}: {
  sessionId: string
  archiving: boolean
  trail: boolean[]
  expanded: boolean
  draggable: boolean
  onReorder?: Reorder
  children: ReactNode
}) {
  const frame = (
    <div
      className={clsx(
        't-collapse t-sidebar-session t-stagger relative',
        archiving ? 'is-hiding' : 'is-shown',
      )}
      data-open={archiving ? 'false' : 'true'}
      draggable={draggable}
      onDragStart={draggable ? (event) => startDrag(event, 'chat', sessionId) : undefined}
      onDragEnd={endDrag}
    >
      <NestedRowBody trail={trail} expanded={expanded}>
        {children}
      </NestedRowBody>
    </div>
  )

  return onReorder ? (
    <ReorderZone sessionId={sessionId} onDrop={onReorder}>
      {frame}
    </ReorderZone>
  ) : (
    frame
  )
}
