import { sanitizePersistedWidths } from '../../lib/tableColumnWidths'

import type { ReactNode } from 'react'

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  /**
   * Fixed starting width. Leave it out to have the column fit itself to its
   * own header and visible cells on first paint.
   */
  width?: number
  /** Prevent persisted/user-resized widths from clipping essential controls. */
  minWidth?: number
  /** Ceiling for the fitted width and for growing. */
  maxWidth?: number
  /**
   * Share of the pane's leftover width this column absorbs. Defaults to the
   * first column that declared no `width` — see `lib/tableColumnWidths`.
   */
  grow?: number
  /**
   * Pin the column to an edge of the pane, so it stays put while the rest of
   * the table scrolls sideways underneath it.
   *
   * Only a run that reaches its edge can pin: a column with an unpinned one
   * between it and the edge has no fixed distance to hold, so it is ignored.
   * Pin several and they stack, the outermost flush with the edge.
   *
   * Pin what a scrolled row cannot be read without — the column that says
   * *which* row this is — and the trailing "⋯", which is otherwise the one
   * affordance a sideways scroll can carry off-screen. Nothing else: pinned
   * width is paid at every window size. Two columns is the practical ceiling.
   */
  pin?: 'left' | 'right'
  sortAccessor?: (row: T) => string | number | boolean | null | undefined
  /** Makes this value navigable without turning the whole row into a link. */
  onActivate?: (row: T) => void
  canActivate?: (row: T) => boolean
  activationLabel?: (row: T) => string
  /** Overrides identifier-column detection for the row's primary action. */
  primaryAction?: boolean
}

export type { StickyLayout, StickyPin } from '../../lib/tableStickyLayout'

export type SortState = { key: string; dir: 'asc' | 'desc' } | null

export const CHECKBOX_COL_WIDTH = 36
// Starting guess for the virtualizer; real heights come from measureElement,
// so this only affects the first paint's scrollbar estimate.
export const ROW_HEIGHT_ESTIMATE = 30
export const EMPTY_KEYS: ReadonlySet<string> = new Set()
// `tw3` holds user-dragged widths only. `tw2` held every width including the
// computed defaults, which froze them permanently — it is dropped on mount.
export const COLUMN_WIDTH_STORAGE_PREFIX = 'nuphos.tw3.'
export const LEGACY_COLUMN_WIDTH_STORAGE_PREFIX = 'nuphos.tw2.'
export const SORT_STORAGE_PREFIX = 'nuphos.tw2.sort.'

/**
 * Flags, per edge, "there are columns hidden under the run pinned here" on the
 * scroll pane — which is what reveals that run's shade (`[data-scrolled-x-*]`
 * in index.css). The two are independent: scrolled to the far right, the right
 * run covers nothing and must stop shading, while the left run still does.
 *
 * Written straight to the DOM rather than to state: this runs on every scroll
 * frame, and a re-render per frame would cost far more than two attributes.
 * Also called after layout, since the column widths and the pane decide
 * whether the table overflows at all.
 */
export function markHorizontalScroll(el: HTMLElement | null) {
  if (!el) return
  flag(el, 'data-scrolled-x-start', el.scrollLeft > 0)
  // Rounded up: a fractional scrollLeft never quite reaches the maximum, and
  // would leave the right run shading nothing forever.
  flag(el, 'data-scrolled-x-end', Math.ceil(el.scrollLeft) < el.scrollWidth - el.clientWidth)
}

function flag(el: HTMLElement, name: string, on: boolean) {
  if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on)
}

export function readStoredWidths(storageKey: string): unknown {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`${COLUMN_WIDTH_STORAGE_PREFIX}${storageKey}`)

    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function readUserWidths(
  storageKey: string | undefined,
  columns: Column<unknown>[],
): Record<string, number> {
  if (!storageKey) return {}

  return sanitizePersistedWidths(columns, readStoredWidths(storageKey))
}

export function parseSavedSort(
  raw: string | null,
  columns: Column<unknown>[],
): SortState | undefined {
  if (!raw) return undefined
  try {
    if (raw === 'null') return null
    const saved = JSON.parse(raw) as Partial<NonNullable<SortState>>

    if (
      typeof saved.key === 'string' &&
      (saved.dir === 'asc' || saved.dir === 'desc') &&
      columns.some((column) => column.key === saved.key && column.sortAccessor)
    ) {
      return { key: saved.key, dir: saved.dir }
    }
  } catch {
    // ignore
  }

  return undefined
}
