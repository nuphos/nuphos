import type { Item, Section } from './types'

function attention(items: Item[]): boolean {
  return items.some(
    (item) => item.unread || item.taskState === 'attention' || item.dot === 'waiting',
  )
}
function latest(items: Item[]): number {
  return Math.max(0, ...items.map((item) => Date.parse(item.lastActiveAt ?? '') || 0))
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
  const ordered = [...groups.values()].sort(
    (a, b) =>
      Number(b.some((item) => item.dot === 'waiting')) -
        Number(a.some((item) => item.dot === 'waiting')) || latest(b) - latest(a),
  )
  const inbox = ordered.filter(attention).flat()
  const read = ordered.filter((group) => !attention(group)).flat()

  return [
    { title: 'Tasks', items: inbox, compact: true },
    ...(read.length ? [{ items: read, compact: true, separator: inbox.length > 0 }] : []),
  ]
}
