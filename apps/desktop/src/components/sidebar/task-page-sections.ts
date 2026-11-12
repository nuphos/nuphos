import type { Item, Section } from './types'

function priority(items: Item[]): number {
  if (items.some((item) => item.taskState === 'attention' && item.dot === 'waiting')) return 0
  if (items.some((item) => item.taskState === 'attention')) return 1
  if (items.some((item) => item.taskState === 'working')) return 2
  // Keep an empty, newly added folder available for its first task.
  if (items.every((item) => item.project)) return 3

  return 4
}

/** Keep each project or parent task with its descendants when grouping by status. */
export function taskPageSections(items: Item[]): Section[] {
  const rows = items.filter((item) => item.project || (item.task && !item.bot))
  const byKey = new Map(rows.map((item) => [item.key, item]))
  const groups = new Map<string, Item[]>()

  for (const item of rows) {
    let root = item
    const seen = new Set([root.key])

    while (root.parentKey && byKey.has(root.parentKey) && !seen.has(root.parentKey)) {
      root = byKey.get(root.parentKey)!
      seen.add(root.key)
    }
    const group = groups.get(root.key) ?? []

    group.push(item)
    groups.set(root.key, group)
  }
  const ordered = [...groups.values()].sort((a, b) => priority(a) - priority(b))
  const active = ordered.filter((group) => priority(group) < 4).flat()
  const idle = ordered.filter((group) => priority(group) === 4).flat()

  return [
    { title: 'Tasks', items: active, compact: true },
    ...(idle.length ? [{ items: idle, compact: true, separator: active.length > 0 }] : []),
  ]
}
