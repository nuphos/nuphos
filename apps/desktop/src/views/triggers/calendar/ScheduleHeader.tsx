import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../../components/ui/menu'
import { viewerTimeZone, zoneLabel } from '../cronTime'

import { SCHEDULE_VIEW_MODES } from './model'

import type { ScheduleViewMode } from './model'

type Props = {
  title: string
  mode: ScheduleViewMode
  onChangeMode: (mode: ScheduleViewMode) => void
  onToday: () => void
  onShift: (direction: 1 | -1) => void
}

/** The calendar's own control row: period title, Day/Week/Month, Today, paging. */
export function ScheduleHeader({ title, mode, onChangeMode, onToday, onShift }: Props) {
  const currentLabel = SCHEDULE_VIEW_MODES.find((option) => option.value === mode)?.label

  return (
    <div className="flex items-center justify-between gap-3 border-b border-main px-4 py-2">
      <div className="min-w-0">
        <div className="text-[16px] font-semibold text-main">{title}</div>
        <div className="truncate text-[11.5px] text-tertiary">
          Times shown in your time zone ({zoneLabel(viewerTimeZone(), new Date())}). Trigger
          schedules run in UTC.
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Menu>
          <MenuTrigger
            className="flex h-7 items-center gap-1 rounded-md border border-main bg-surface px-2.5 text-[12.5px] font-medium text-main transition-colors hover:bg-zGray-800 data-[popup-open]:bg-zGray-800"
            aria-label="Schedule view"
          >
            {currentLabel}
            <ChevronDown className="h-3.5 w-3.5 text-tertiary" strokeWidth={2} />
          </MenuTrigger>
          <MenuContent align="end">
            {SCHEDULE_VIEW_MODES.map((option) => (
              <MenuItem
                key={option.value}
                selected={option.value === mode}
                onClick={() => onChangeMode(option.value)}
              >
                {option.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <Button variant="secondary" size="sm" className="!h-7 text-[12.5px]" onClick={onToday}>
          Today
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={() => onShift(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next" onClick={() => onShift(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
