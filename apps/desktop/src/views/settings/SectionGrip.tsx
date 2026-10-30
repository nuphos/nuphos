import clsx from 'clsx'
import { GripVertical } from 'lucide-react'
import { forwardRef, useRef, useState } from 'react'

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { ShortcutHint } from '../../components/ui/shortcut-hint'
import { t } from '../../i18n'

import { gripClickOpens, gripKeyStep, gripMenuAcceptsOpen } from './sectionOrderPresentation'

import type { DragEvent, KeyboardEvent } from 'react'

/** Where the grip sits by default: in the gutter left of its section. */
const GUTTER = 'absolute -left-[18px] top-0 h-6 w-4 lg:-left-7 lg:w-5'

/**
 * The six-dot handle beside a reorderable section, as in Notion: drag it to move the
 * section, click it for a menu that does the same without a pointer, or press
 * Alt+Up / Alt+Down while it has focus. Without `onDragStart` the grip is not a
 * native drag source, so a surrounding drag library can take its presses; without
 * `onReset` the menu only moves.
 */
export const SectionGrip = forwardRef<
  HTMLButtonElement,
  {
    label: string
    canMoveUp: boolean
    canMoveDown: boolean
    canReset?: boolean
    onMove: (step: -1 | 1) => void
    onReset?: () => void
    onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
    onDragEnd?: () => void
    /** Placement and size, replacing the gutter position. */
    className?: string
  }
>(function SectionGrip(
  { label, canMoveUp, canMoveDown, canReset, onMove, onReset, onDragStart, onDragEnd, className },
  ref,
) {
  const [open, setOpen] = useState(false)
  // A press on the grip while its menu is open closes it; the click after must not reopen.
  const openAtPress = useRef(false)
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = gripKeyStep(event)

    if (step === null) return
    event.preventDefault()

    if (step === -1 ? canMoveUp : canMoveDown) onMove(step)
  }

  return (
    <Menu
      open={open}
      onOpenChange={(next, details) => {
        if (!next || gripMenuAcceptsOpen(details.event)) setOpen(next)
      }}
    >
      <MenuTrigger
        ref={ref}
        aria-label={t('Move {name}', { name: label })}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        title={t('Drag to move, click for options')}
        draggable={onDragStart !== undefined}
        onPointerDown={() => {
          openAtPress.current = open
        }}
        onClick={(event) => {
          if (gripClickOpens(event.detail, openAtPress.current)) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        onDragStart={(event) => {
          setOpen(false)
          onDragStart?.(event)
        }}
        onDragEnd={onDragEnd}
        className={clsx(
          className ?? GUTTER,
          'flex cursor-grab items-center justify-center rounded text-tertiary opacity-0 outline-none transition-opacity hover:bg-zGray-800/60 hover:text-main focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-zViolet-500/60 active:cursor-grabbing group-hover/section:opacity-100 data-[popup-open]:opacity-100 motion-reduce:transition-none',
        )}
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </MenuTrigger>
      <MenuContent side="bottom" align="start">
        <MenuItem
          disabled={!canMoveUp}
          hint={<ShortcutHint combo="alt+up" className="pl-4" />}
          onClick={() => onMove(-1)}
        >
          {t('Move up')}
        </MenuItem>
        <MenuItem
          disabled={!canMoveDown}
          hint={<ShortcutHint combo="alt+down" className="pl-4" />}
          onClick={() => onMove(1)}
        >
          {t('Move down')}
        </MenuItem>
        {onReset && (
          <>
            <MenuSeparator />
            <MenuItem disabled={!canReset} onClick={onReset}>
              {t('Reset order')}
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
})
