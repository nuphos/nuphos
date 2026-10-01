import clsx from 'clsx'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useSuspendTitlebarDrag } from '../hooks/useSuspendTitlebarDrag'

import { InputGroup, InputGroupInput } from './ui/input-group'

export function SearchBox({
  filter,
  onFilterChange,
  count,
  fill = false,
  label = 'Filter',
  autoFocus = false,
}: {
  filter: string
  onFilterChange: (f: string) => void
  /** Shown in the collapsed placeholder. Omit when the box is `fill`. */
  count?: number
  /**
   * Span the container instead of growing on focus. The grow-on-focus width is
   * for the Toolbar's crowded controls row; a box that owns its own row (the
   * Chats reader's list rail) should just fill it.
   */
  fill?: boolean
  /** Placeholder / aria-label, for boxes that search something specific. */
  label?: string
  /**
   * Take focus on mount. For a box that opens with its own surface — a picker
   * modal, where filtering is the reason the surface appeared — so typing works
   * straight away. Never on a box that shares a page with other controls.
   */
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const expanded = fill || focused || filter.length > 0
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Only the grow-on-focus box holds the titlebar down, and only while it is
  // actually grown: the strips beside it are drag regions, and a press there is
  // a window drag the input never hears about — so it would sit expanded until
  // something else happened to take focus.
  useSuspendTitlebarDrag(!fill && focused)

  // Blur on any press outside. `onBlur` alone is not enough: on macOS a press
  // on a <button> — every filter chip beside this box is one — does not move
  // focus, so the input stays focused and the box stays open.
  useEffect(() => {
    if (fill || !focused) return
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return
      inputRef.current?.blur()
    }

    document.addEventListener('pointerdown', onPointerDown, true)

    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [fill, focused])

  // A single always-mounted input (rather than a button⇄input swap) so the box
  // can grow smoothly on focus — CSS can't transition an auto width, so the
  // collapsed state carries a fixed one. The item count lives in the collapsed
  // placeholder and gives way to the label once expanded.
  return (
    <InputGroup
      ref={boxRef}
      className={clsx(
        'h-7 min-w-0 flex items-center rounded-md transition-[width,background-color] duration-200 ease-out',
        fill
          ? 'bg-field w-full'
          : expanded
            ? 'bg-field w-[240px] max-w-full flex-shrink'
            : // Never the thing that gives way: the controls beside it are
              // flex-shrink-0, so without this the collapsed box is the only
              // shrinkable child and a busy controls row squeezes it to nothing —
              // leaving its (shrink-proof) magnifier jammed against the chips.
              'w-[104px] flex-shrink-0 hover:bg-field/80',
      )}
    >
      <Search className="w-3.5 h-3.5 ml-2 text-tertiary flex-shrink-0" strokeWidth={2} />
      <InputGroupInput
        ref={inputRef}
        type="text"
        aria-label={label}
        autoFocus={autoFocus}
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={
          expanded || count === undefined
            ? label
            : `${String(count)} ${count === 1 ? 'item' : 'items'}`
        }
        className="ml-1.5 pr-2 text-[12.5px] placeholder:text-tertiary text-main"
      />
    </InputGroup>
  )
}
