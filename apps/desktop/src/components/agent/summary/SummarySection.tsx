import { useContext } from 'react'
import { createPortal } from 'react-dom'

import { SummaryLayoutActions, SummaryLayoutTitle } from './summaryLayoutContext'

import type { ReactNode, Ref } from 'react'

const sectionClass = 'rounded-xl border border-line-control px-3.5 py-3'

/** A titled block of rows; `header` sits under the title, above the rows; `action` ends the title's line. */
export function SummarySection({
  title,
  header,
  action,
  ref,
  children,
}: {
  title: string
  header?: ReactNode
  action?: ReactNode
  ref?: Ref<HTMLElement>
  children: ReactNode
}) {
  const layoutTitle = useContext(SummaryLayoutTitle)
  const actionHost = useContext(SummaryLayoutActions)
  const actionTarget = actionHost?.target
  const portaled = layoutTitle === title && actionTarget && action
  const heading =
    layoutTitle === title ? null : <h3 className="text-[13px] font-medium text-main">{title}</h3>

  let titleRow = heading

  if (portaled)
    titleRow = createPortal(<span onClick={actionHost.onAction}>{action}</span>, actionTarget)
  else if (action)
    titleRow = (
      <div className="-my-1.5 -mr-2 flex items-center justify-between gap-2">
        {heading ?? <span />}
        {action}
      </div>
    )

  return (
    <section ref={ref} className={layoutTitle === null ? sectionClass : ''} aria-label={title}>
      {titleRow}
      {header}
      <div className="flex flex-col gap-0.5 pt-2">{children}</div>
    </section>
  )
}
