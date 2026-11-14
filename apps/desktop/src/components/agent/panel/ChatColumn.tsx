import clsx from 'clsx'

import type { ReactNode } from 'react'

/**
 * A chat's one column: its width and its clearance from the pane edges. Every row of a chat
 * (transcript, queued messages, reply bar, composer) sits in it at full width and sets no width
 * of its own, so the rows cannot drift apart; a row narrower than the column insets inside it.
 */
export function ChatColumn({
  sidebar = false,
  className,
  children,
}: {
  sidebar?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={clsx(
        'mx-auto w-full max-w-[calc(760px+1.5rem)]',
        sidebar ? 'px-2.5' : 'px-3',
        className,
      )}
    >
      {children}
    </div>
  )
}
