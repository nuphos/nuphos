import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EMPTY_KEYS } from './support'

import type { Virtualizer } from '@tanstack/react-virtual'

export function useTableSelection<T>({
  selectable,
  selectedKeys,
  onSelectedKeysChange,
  sortedRows,
  rowKey,
}: {
  selectable: boolean
  selectedKeys: Set<string> | undefined
  onSelectedKeysChange?: (next: Set<string>) => void
  sortedRows: T[]
  rowKey: (row: T) => string
}) {
  const selected = selectedKeys ?? (EMPTY_KEYS as Set<string>)
  // `lastIndexRef` is the range anchor (last row clicked); `cursorIndexRef`
  // is the moving edge driven by Shift+Arrow keys, Linear-style. `hoverIndexRef`
  // is the row under the cursor, used as the anchor when Shift+Arrow starts a
  // selection from a plain hover (no prior click).
  const lastIndexRef = useRef<number | null>(null)
  const cursorIndexRef = useRef<number | null>(null)
  const hoverIndexRef = useRef<number | null>(null)
  // A Shift+Arrow run is a "gesture": its mode (add vs remove) is locked in
  // from whether the starting row was already selected, and each step repaints
  // the anchor→cursor range over a snapshot of the selection taken when the
  // gesture began. Non-null base = a gesture is in progress. Any plain Arrow,
  // Space, mouse move, or Escape ends it.
  const gestureBaseRef = useRef<Set<string> | null>(null)
  const gestureModeRef = useRef<'add' | 'remove'>('add')
  // Last *real* pointer position, used to tell a genuine mouse move from the
  // synthetic mousemove Chromium fires when Shift+Arrow scrolls content under a
  // stationary cursor (same coords → ignore, so keyboard nav isn't interrupted).
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null)
  // Linear-style focused row: the keyboard cursor, set once a Shift+Arrow
  // selection begins (NOT on plain hover) and following the moving edge after.
  // A real mouse move clears it (and the anchor) so the next Shift+Arrow starts
  // fresh from the hovered row; clearing the selection clears it too.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const onRowHover = useCallback((index: number) => {
    hoverIndexRef.current = index
  }, [])
  const visibleKeys = useMemo(() => sortedRows.map(rowKey), [sortedRows, rowKey])
  const allSelected =
    selectable && visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k))
  const someSelected = selectable && !allSelected && visibleKeys.some((k) => selected.has(k))

  function toggleAll() {
    const next = new Set(selected)

    if (allSelected) for (const k of visibleKeys) next.delete(k)
    else for (const k of visibleKeys) next.add(k)
    onSelectedKeysChange?.(next)
  }

  // Stable identity (modulo selection changes) so it doesn't break the
  // memoized rows on scroll re-renders.
  const onRowCheck = useCallback(
    (index: number, shiftKey: boolean) => {
      const next = new Set(selected)

      if (shiftKey && lastIndexRef.current != null) {
        // Shift-click extends the selection over the contiguous range.
        const [a, b] = [lastIndexRef.current, index].sort((x, y) => x - y)

        for (let i = a; i <= b; i++) next.add(visibleKeys[i])
      } else {
        const key = visibleKeys[index]

        if (next.has(key)) next.delete(key)
        else next.add(key)
      }
      lastIndexRef.current = index
      cursorIndexRef.current = index
      onSelectedKeysChange?.(next)
    },
    [selected, visibleKeys, onSelectedKeysChange],
  )

  // A genuine mouse move cancels the keyboard focus/selection session: it
  // drops the focus border and the range anchor so the next Shift+Arrow
  // re-starts from whatever row is now hovered. Chromium's synthetic
  // scroll-time mousemove (same coords) is filtered out so it doesn't
  // interrupt continuous keyboard navigation.
  function onContainerMouseMove(e: React.MouseEvent) {
    const last = pointerPosRef.current

    if (last?.x === e.clientX && last.y === e.clientY) return
    pointerPosRef.current = { x: e.clientX, y: e.clientY }
    lastIndexRef.current = null
    cursorIndexRef.current = null
    gestureBaseRef.current = null
    setFocusedIndex(null)
  }

  // Drop the hover anchor when the cursor leaves this table so a Shift+Arrow
  // hover-start only ever fires for the table the cursor is over (multiple
  // selectable tables can be mounted at once).
  function onContainerMouseLeave() {
    hoverIndexRef.current = null
  }

  return {
    selected,
    focusedIndex,
    setFocusedIndex,
    visibleKeys,
    allSelected,
    someSelected,
    toggleAll,
    onRowCheck,
    onRowHover,
    onContainerMouseMove,
    onContainerMouseLeave,
    lastIndexRef,
    cursorIndexRef,
    hoverIndexRef,
    gestureBaseRef,
    gestureModeRef,
  }
}

// Linear-style keyboard interaction, all scoped to this table:
//   • ArrowUp/Down       — move the focused row (no selection change).
//   • Shift+ArrowUp/Down  — extend the selection from the anchor.
//   • Space               — toggle selection of the focused row.
//   • Escape              — clear the selection.
// Focus is the keyboard cursor, mirrored in cursorIndexRef so this window
// listener reads it without re-subscribing; a real mouse move clears focus
// (see onContainerMouseMove) so a fresh Arrow re-starts from the hover.
export function useTableKeyboardNav({
  selectable,
  selection,
  onSelectedKeysChange,
  virtualizer,
  scrollRef,
}: {
  selectable: boolean
  selection: ReturnType<typeof useTableSelection>
  onSelectedKeysChange?: (next: Set<string>) => void
  virtualizer: Virtualizer<HTMLDivElement, Element>
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const {
    selected,
    visibleKeys,
    setFocusedIndex,
    lastIndexRef,
    cursorIndexRef,
    hoverIndexRef,
    gestureBaseRef,
    gestureModeRef,
  } = selection

  useEffect(() => {
    if (!selectable) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return
      // Only act when nothing more specific owns the keys: focus on <body> or
      // inside this table. A focused input/button, an open menu or dialog, and
      // the agent panel's ESC-to-stop all keep their own keys.
      const target = e.target as HTMLElement | null
      const ownsKeys =
        target == null || target === document.body || (scrollRef.current?.contains(target) ?? false)

      if (!ownsKeys) return

      if (e.key === 'Escape') {
        if (e.defaultPrevented || selected.size === 0) return
        e.preventDefault()
        lastIndexRef.current = null
        cursorIndexRef.current = null
        gestureBaseRef.current = null
        setFocusedIndex(null)
        onSelectedKeysChange?.(new Set())

        return
      }

      const max = visibleKeys.length - 1

      if (max < 0) return

      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        // Resolve a starting row: the keyboard cursor, else the hovered row.
        const focus = cursorIndexRef.current ?? hoverIndexRef.current

        if (focus == null || focus > max) return // pointer not over this table
        e.preventDefault()
        if (gestureBaseRef.current == null) {
          // First press: anchor here, snapshot the selection, and lock the mode
          // from this row's state — already selected ⇒ this run deselects.
          gestureBaseRef.current = new Set(selected)
          gestureModeRef.current = selected.has(visibleKeys[focus]) ? 'remove' : 'add'
          lastIndexRef.current = focus
          cursorIndexRef.current = focus
          setFocusedIndex(focus)
          const next = new Set(gestureBaseRef.current)

          if (gestureModeRef.current === 'add') next.add(visibleKeys[focus])
          else next.delete(visibleKeys[focus])
          onSelectedKeysChange?.(next)

          return
        }
        const cursor = Math.min(max, cursorIndexRef.current ?? focus)
        const nextCursor = Math.max(0, Math.min(max, cursor + (e.key === 'ArrowDown' ? 1 : -1)))

        if (nextCursor === cursor) return
        // Repaint the anchor→cursor range over the gesture's base snapshot, so
        // rows that fall outside the range revert to their pre-gesture state.
        const anchor = lastIndexRef.current ?? cursor
        const mode = gestureModeRef.current
        const next = new Set(gestureBaseRef.current)
        const lo = Math.min(anchor, nextCursor)
        const hi = Math.max(anchor, nextCursor)

        for (let i = lo; i <= hi; i++) {
          if (mode === 'add') next.add(visibleKeys[i])
          else next.delete(visibleKeys[i])
        }
        cursorIndexRef.current = nextCursor
        setFocusedIndex(nextCursor)
        virtualizer.scrollToIndex(nextCursor)
        onSelectedKeysChange?.(next)

        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Plain arrow moves focus only and ends any Shift gesture.
        gestureBaseRef.current = null
        if (cursorIndexRef.current == null) {
          const hovered = hoverIndexRef.current

          if (hovered == null || hovered > max) return // pointer not over this table
          e.preventDefault()
          lastIndexRef.current = hovered
          cursorIndexRef.current = hovered
          setFocusedIndex(hovered)

          return
        }
        e.preventDefault()
        const cursor = Math.min(max, cursorIndexRef.current)
        const nextCursor = Math.max(0, Math.min(max, cursor + (e.key === 'ArrowDown' ? 1 : -1)))

        if (nextCursor === cursor) return
        lastIndexRef.current = nextCursor
        cursorIndexRef.current = nextCursor
        setFocusedIndex(nextCursor)
        virtualizer.scrollToIndex(nextCursor)

        return
      }

      if (e.key === ' ' || e.key === 'Spacebar') {
        const focus = cursorIndexRef.current

        if (focus == null || focus > max) return
        e.preventDefault()
        gestureBaseRef.current = null // Space ends any Shift gesture
        const key = visibleKeys[focus]
        const next = new Set(selected)

        if (next.has(key)) next.delete(key)
        else next.add(key)
        onSelectedKeysChange?.(next)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters are identity-stable
  }, [selectable, selected, visibleKeys, onSelectedKeysChange, virtualizer])
}
