import type { KeyboardEvent } from 'react'

/** Row focus for the model menus: ↑/↓ move, ← steps back, → opens a submenu. */
export function menuKeyDown(
  event: KeyboardEvent<HTMLElement>,
  { onBack, onForward }: { onBack?: () => void; onForward?: (row: HTMLElement) => boolean },
) {
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[data-menu-row]:not([disabled])'),
  ]
  const active = document.activeElement as HTMLElement | null
  const index = active ? rows.indexOf(active) : -1

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const step = event.key === 'ArrowDown' ? 1 : -1

    rows[(index + step + rows.length) % rows.length]?.focus()
  } else if (event.key === 'ArrowLeft' && onBack) onBack()
  else if (!(event.key === 'ArrowRight' && active && onForward?.(active))) return
  event.preventDefault()
  event.stopPropagation()
}

/** Focus the checked row, or the first, when a menu shows. */
export function focusCurrentRow(container: HTMLElement | null) {
  const rows = container?.querySelectorAll<HTMLElement>('[data-menu-row]:not([disabled])')

  ;(
    container?.querySelector<HTMLElement>('[data-menu-row][aria-checked="true"]') ?? rows?.[0]
  )?.focus()
}
