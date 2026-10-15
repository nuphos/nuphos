import { ChevronDown, ChevronRight, CircleCheck } from 'lucide-react'

import { SIDEBAR_ROW_CLASS } from '../SidebarNavItem'

import { foldGroup } from './done-threads'
import { NestedRowBody } from './nest-guides'

import type { DoneFold, GroupState } from './done-threads'

/** The "N done" row standing in for a chat's finished threads; toggles them open. */
export function DoneThreadsRow({
  fold: { parentKey, count, open },
  trail,
  toggleGroup,
}: {
  fold: DoneFold
  trail: boolean[]
  toggleGroup: (group: GroupState) => void
}) {
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="t-collapse t-sidebar-session t-stagger relative is-shown" data-open="true">
      <NestedRowBody trail={trail} expanded={false}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${String(count)} finished threads`}
          onClick={() => toggleGroup(foldGroup(parentKey))}
          className={`${SIDEBAR_ROW_CLASS} group w-full flex items-center text-tertiary transition-colors hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary focus-visible:bg-[var(--sidebar-overlay-focus)] outline-none motion-reduce:transition-none`}
        >
          <CircleCheck className="size-3.5 flex-shrink-0" strokeWidth={1.8} />
          <span className="flex-1 truncate text-left text-[13px]">{String(count)} done</span>
          <Chevron className="size-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </NestedRowBody>
    </div>
  )
}
