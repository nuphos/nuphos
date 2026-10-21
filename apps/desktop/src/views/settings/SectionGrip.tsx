import { GripVertical } from 'lucide-react'
import { forwardRef, useRef, useState } from 'react'

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { ShortcutHint } from '../../components/ui/shortcut-hint'

import { gripClickOpens, gripKeyStep, gripMenuAcceptsOpen } from './sectionOrderPresentation'

import type { DragEvent, KeyboardEvent } from 'react'

/**
 * The six-dot handle beside a reorderable section, as in Notion: drag it to move the
 * section, click it for a menu that does the same without a pointer, or press
 * Alt+Up / Alt+Down while it has focus.
 */
export const SectionGrip = forwardRef<
  HTMLButtonElement,
  {
    label: string
    canMoveUp: boolean
    canMoveDown: boolean
    canReset: boolean
    onMove: (step: -1 | 1) => void
    onReset: () => void
    onDragStart: (event: DragEvent<HTMLButtonElement>) => void
    onDragEnd: () => void
  }
>(function SectionGrip(
  { label, canMoveUp, canMoveDown, canReset, onMove, onReset, onDragStart, onDragEnd },
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
        aria-label={`Move ${label}`}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        title="Drag to move, click for options"
        draggable
        onPointerDown={() => {
          openAtPress.current = open
        }}
        onClick={(event) => {
          if (gripClickOpens(event.detail, openAtPress.current)) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        onDragStart={(event) => {
          setOpen(false)
          onDragStart(event)
        }}
        onDragEnd={onDragEnd}
        className="absolute -left-[18px] top-0 flex h-6 w-4 lg:-left-7 lg:w-5 cursor-grab items-center justify-center rounded text-tertiary opacity-0 outline-none transition-opacity hover:bg-zGray-800/60 hover:text-main focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-zViolet-500/60 active:cursor-grabbing group-hover/section:opacity-100 data-[popup-open]:opacity-100 motion-reduce:transition-none"
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </MenuTrigger>
      <MenuContent side="bottom" align="start">
        <MenuItem
          disabled={!canMoveUp}
          hint={<ShortcutHint combo="alt+up" className="pl-4" />}
          onClick={() => onMove(-1)}
        >
          Move up
        </MenuItem>
        <MenuItem
          disabled={!canMoveDown}
          hint={<ShortcutHint combo="alt+down" className="pl-4" />}
          onClick={() => onMove(1)}
        >
          Move down
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canReset} onClick={onReset}>
          Reset order
        </MenuItem>
      </MenuContent>
    </Menu>
  )
})
