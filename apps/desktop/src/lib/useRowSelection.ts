import { useCallback, useMemo, useState } from 'react'

/**
 * Controlled row-selection state for the shared Table's multi-select. Holds the
 * selected rowKeys, derives the currently-visible selected items, and clears the
 * selection when the scope (`resetKey`, e.g. namespace+context) changes so stale
 * selections don't carry across views.
 */
export function useRowSelection<T>(items: T[], keyOf: (item: T) => string, resetKey: string) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())

  // Adjust-state-during-render rather than an effect, so the stale selection is
  // never handed to the table for one commit after the scope changed.
  const [scope, setScope] = useState(resetKey)

  if (scope !== resetKey) {
    setScope(resetKey)
    setSelectedKeys(new Set())
  }

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(keyOf(item))),
    [items, selectedKeys, keyOf],
  )

  const clear = useCallback(() => setSelectedKeys(new Set()), [])

  return { selectedKeys, setSelectedKeys, selectedItems, clear }
}
