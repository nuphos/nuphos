import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { clampMeasured, layoutColumnWidths, mergeForStorage } from '../../lib/tableColumnWidths'

import {
  CHECKBOX_COL_WIDTH,
  COLUMN_WIDTH_STORAGE_PREFIX,
  LEGACY_COLUMN_WIDTH_STORAGE_PREFIX,
  readStoredWidths,
  readUserWidths,
} from './support'

import type { Column } from './support'

export function useTableColumnWidths<T>({
  columns,
  columnSig,
  storageKey,
  selectable,
}: {
  columns: Column<T>[]
  columnSig: string
  storageKey: string | undefined
  selectable: boolean
}) {
  // Only widths the user dragged are state; the rest is derived every render
  // from the measured content and the pane width, so a table re-fits itself
  // when its data, its column set, or the window changes.
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  // The widths travel with the key they were loaded from. A view that swaps its
  // `storageKey` on a mounted table (`betterstack.${page}`) would otherwise
  // write the outgoing table's widths under the incoming table's key.
  const [userState, setUserState] = useState<{
    storageKey?: string
    widths: Record<string, number>
  }>(() => ({
    storageKey,
    widths: readUserWidths(storageKey, columns as Column<unknown>[]),
  }))
  const userWidths = userState.widths
  const setUserWidths = useCallback(
    (update: (cur: Record<string, number>) => Record<string, number>) => {
      setUserState((cur) => {
        const widths = update(cur.widths)

        return widths === cur.widths ? cur : { ...cur, widths }
      })
    },
    [],
  )
  const [measured, setMeasured] = useState<Record<string, number>>({})
  const [paneWidth, setPaneWidth] = useState(0)

  // Re-read on a key change (a different table) or when the column set grows
  // (conditional columns): the state initializer only ever runs once.
  const loadedRef = useRef({ storageKey, columnSig })

  useEffect(() => {
    const loaded = loadedRef.current

    if (loaded.storageKey === storageKey && loaded.columnSig === columnSig) return
    const keyChanged = loaded.storageKey !== storageKey

    loadedRef.current = { storageKey, columnSig }
    const stored = readUserWidths(storageKey, columns as Column<unknown>[])

    setUserState((cur) =>
      keyChanged
        ? { storageKey, widths: stored }
        : // Same table, new columns — adopt what was stored for the columns that
          // just appeared without discarding drags made since mount.
          { storageKey, widths: { ...stored, ...cur.widths } },
    )
  }, [storageKey, columnSig, columns])

  useEffect(() => {
    const key = userState.storageKey

    if (!key) return
    try {
      localStorage.removeItem(`${LEGACY_COLUMN_WIDTH_STORAGE_PREFIX}${key}`)
      const merged = mergeForStorage(
        readStoredWidths(key),
        userState.widths,
        columns.map((c) => c.key),
      )

      if (Object.keys(merged).length === 0) {
        localStorage.removeItem(`${COLUMN_WIDTH_STORAGE_PREFIX}${key}`)
      } else {
        localStorage.setItem(`${COLUMN_WIDTH_STORAGE_PREFIX}${key}`, JSON.stringify(merged))
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- columnSig stands in for columns
  }, [userState, columnSig])

  // Layout effect so the first paint already has the real pane width — read it
  // after paint and every table would flash at its unstretched width first.
  useLayoutEffect(() => {
    const el = scrollRef.current

    if (!el) return
    const update = () => setPaneWidth(el.clientWidth)

    update()
    const ro = new ResizeObserver(update)

    ro.observe(el)

    return () => ro.disconnect()
  }, [])

  const widths = useMemo(
    () =>
      layoutColumnWidths(columns, {
        userWidths,
        measured,
        available: Math.max(0, paneWidth - (selectable ? CHECKBOX_COL_WIDTH : 0)),
      }),
    [columns, userWidths, measured, paneWidth, selectable],
  )

  return { scrollRef, tableRef, setUserWidths, setMeasured, widths }
}

// One render with the columns free to size themselves, then read the header
// widths back: `table-layout: auto` sizes each column to the widest of its
// header and rendered cells, which is the number a px guess can never get
// right across locales (CJK runs ~2x wider per character). A layout effect
// reads and clears the pass, so the free-form layout is never painted.
export function useTableColumnFit<T>({
  columns,
  columnSig,
  rowCount,
  virtualRowCount,
  tableRef,
  setMeasured,
  setUserWidths,
}: {
  columns: Column<T>[]
  columnSig: string
  rowCount: number
  virtualRowCount: number
  tableRef: React.RefObject<HTMLTableElement | null>
  setMeasured: React.Dispatch<React.SetStateAction<Record<string, number>>>
  setUserWidths: (update: (cur: Record<string, number>) => Record<string, number>) => void
}) {
  const [fitting, setFitting] = useState(false)
  // Columns to re-fit even though they declared a width — a double-click on the
  // resize handle asks for one explicitly.
  const refitRef = useRef(new Set<string>())
  const fittedSigRef = useRef('')

  useLayoutEffect(() => {
    if (fitting) return
    // Fitting before the virtualizer has placed a row would size the columns to
    // their headers alone, so wait for content (or for a genuinely empty table).
    if (rowCount > 0 && virtualRowCount === 0) return
    const sig = `${columnSig}#${rowCount === 0 ? 'empty' : 'rows'}`

    if (sig === fittedSigRef.current) return
    fittedSigRef.current = sig
    setFitting(true)
  }, [fitting, columnSig, rowCount, virtualRowCount])

  useLayoutEffect(() => {
    if (!fitting) return
    const cells = tableRef.current?.querySelectorAll<HTMLTableCellElement>('thead th[data-col-key]')
    const refit = refitRef.current

    if (cells) {
      const byKey = new Map<string, number>()

      for (const cell of cells) {
        if (cell.dataset.colKey) byKey.set(cell.dataset.colKey, cell.offsetWidth)
      }
      setMeasured((cur) => {
        const next = { ...cur }
        let changed = false

        for (const col of columns) {
          // A declared width is an explicit decision — don't second-guess it.
          if (col.width != null && !refit.has(col.key)) continue
          const width = byKey.get(col.key)

          if (width == null) continue
          const fitted = clampMeasured(col, width)

          if (next[col.key] === fitted) continue
          next[col.key] = fitted
          changed = true
        }

        return changed ? next : cur
      })
    }
    refit.clear()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ends the one-frame fitting pass
    setFitting(false)
  }, [fitting, columns, tableRef, setMeasured])

  const autoFitColumn = useCallback(
    (key: string) => {
      refitRef.current.add(key)
      setUserWidths((cur) => {
        if (cur[key] == null) return cur
        const next = { ...cur }

        delete next[key]

        return next
      })
      setFitting(true)
    },
    [setUserWidths],
  )

  return { fitting, autoFitColumn }
}
