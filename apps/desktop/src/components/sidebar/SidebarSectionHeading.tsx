import clsx from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { SIDEBAR_GROUP_TITLE_CLASS } from '../SidebarNavItem'

import { SECTION_LABELS } from './section-labels'

import type { Section } from './types'

export function SidebarSectionHeading({
  section,
  collapsed,
  toggle,
}: {
  section: Section
  collapsed: boolean
  toggle: () => void
}) {
  const classes = clsx(SIDEBAR_GROUP_TITLE_CLASS, 'min-w-0 flex-1 flex items-center gap-1.5')
  const title = SECTION_LABELS[section.title ?? ''] ?? section.title

  if (section.nonCollapsible) return <h3 className={classes}>{title}</h3>

  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onPointerDown={(event) => {
        if (event.button === 0) toggle()
      }}
      onClick={(event) => {
        if (event.detail === 0) toggle()
      }}
      className={clsx(classes, 'hover:text-secondary')}
    >
      <span className="text-left">{title}</span>
      {!section.hideChevron && (
        <span className="t-icon-swap w-3 h-3 shrink-0" data-state={collapsed ? 'a' : 'b'}>
          <ChevronRight className="t-icon w-3 h-3" data-icon="a" />
          <ChevronDown className="t-icon w-3 h-3" data-icon="b" />
        </span>
      )}
    </button>
  )
}
