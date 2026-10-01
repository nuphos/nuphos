import clsx from 'clsx'

import { useDetailSidebarTransition } from '../hooks/useDetailSidebarTransition'

import type { CSSProperties, ReactNode } from 'react'

type DetailSidebarTransitionProps = {
  children: (requestClose: () => void) => ReactNode
  className?: string
  onClose: () => void
  /** Set false while another surface owns ESC (e.g. ESC-to-stop a streaming
   *  agent turn) so one keystroke doesn't trigger both. Defaults to true. */
  closeOnEscape?: boolean
  style?: CSSProperties
}

export function DetailSidebarTransition({
  children,
  className,
  onClose,
  closeOnEscape,
  style,
}: DetailSidebarTransitionProps) {
  const { contentOpen, open, panelRef, requestClose } = useDetailSidebarTransition(
    onClose,
    undefined,
    { closeOnEscape },
  )
  const widthStyle: CSSProperties = {
    ...style,
    minWidth: open ? style?.minWidth : 0,
    width: open ? style?.width : 0,
  }

  return (
    <aside
      ref={panelRef}
      data-open={open ? 'true' : 'false'}
      style={widthStyle}
      className={clsx('t-detail-sidebar-frame', className)}
    >
      <div
        className="t-panel-slide t-detail-sidebar-content flex min-h-0 flex-col"
        data-open={contentOpen ? 'true' : 'false'}
      >
        {children(requestClose)}
      </div>
    </aside>
  )
}
