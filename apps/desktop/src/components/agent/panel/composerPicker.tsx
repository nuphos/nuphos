import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'

import type { ReactNode } from 'react'

/** The popup the composer's @ and / menus share, anchored above the caret. */
export function ComposerPicker({
  open,
  anchor,
  label,
  className,
  onClose,
  children,
}: {
  open: boolean
  anchor: Popover.Positioner.Props['anchor']
  label?: string
  className: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="top"
          align="start"
          sideOffset={6}
          className="z-[1000]"
        >
          <Popover.Popup
            role="listbox"
            aria-label={label}
            initialFocus={false}
            finalFocus={false}
            style={{ transformOrigin: 'var(--transform-origin)' }}
            className={clsx(
              't-dropdown is-open max-h-[var(--available-height)] overflow-auto rounded-lg border border-zGray-800/60 bg-main p-1 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
              className,
            )}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** One option. Mouse-down selects without taking focus (and the caret) from the editor. */
export function ComposerPickerRow({
  selected,
  onSelect,
  onActive,
  children,
}: {
  selected: boolean
  onSelect: () => void
  onActive: () => void
  children: ReactNode
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      className={clsx(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
        selected && 'bg-zGray-800/60',
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        onSelect()
      }}
      onMouseEnter={onActive}
    >
      {children}
    </div>
  )
}
