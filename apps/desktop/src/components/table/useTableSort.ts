import { useEffect, useMemo, useState } from 'react'

import { SORT_STORAGE_PREFIX, parseSavedSort } from './support'

import type { Column, SortState } from './support'

export function useTableSort<T>({
  columns,
  storageKey,
  defaultSort,
  rows,
  rowKey,
}: {
  columns: Column<T>[]
  storageKey: string | undefined
  defaultSort: SortState
  rows: T[]
  rowKey: (row: T) => string
}) {
  const [sort, setSort] = useState<SortState>(() => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = parseSavedSort(
        localStorage.getItem(`${SORT_STORAGE_PREFIX}${storageKey}`),
        columns as Column<unknown>[],
      )

      if (saved !== undefined) return saved
    }

    return defaultSort
  })
  const safeRows = Array.isArray(rows) ? rows : []

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(`${SORT_STORAGE_PREFIX}${storageKey}`, JSON.stringify(sort))
    } catch {
      // ignore
    }
  }, [sort, storageKey])

  const sortedRows = useMemo(() => {
    if (!sort) return safeRows
    const col = columns.find((c) => c.key === sort.key)

    if (!col?.sortAccessor) return safeRows
    const acc = col.sortAccessor
    const tieBreak = (a: T, b: T) => {
      const ak = rowKey(a)
      const bk = rowKey(b)

      return ak < bk ? -1 : ak > bk ? 1 : 0
    }
    const out = [...safeRows]

    out.sort((a, b) => {
      const av = acc(a)
      const bv = acc(b)

      if (av == null && bv == null) return tieBreak(a, b)
      if (av == null) return 1
      if (bv == null) return -1
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1

      // Equal primary values: fall back to the stable row key so polled
      // refreshes can't reshuffle ties (e.g. many pods share an Age second).
      return tieBreak(a, b)
    })

    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- safeRows is derived from rows
  }, [rows, sort, columns, rowKey])

  function toggleSort(col: Column<T>) {
    if (!col.sortAccessor) return
    setSort((cur) => {
      if (cur?.key !== col.key) return { key: col.key, dir: 'asc' }
      if (cur.dir === 'asc') return { key: col.key, dir: 'desc' }

      return null
    })
  }

  return { sort, sortedRows, toggleSort }
}
