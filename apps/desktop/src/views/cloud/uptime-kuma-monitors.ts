import type { UptimeKumaMonitor } from '../../types'

function uptimeKumaMonitorStatus(monitor: UptimeKumaMonitor): string {
  if (monitor.active === false) return 'paused'
  if (typeof monitor.status === 'string' && monitor.status.trim()) return monitor.status.trim()
  if (typeof monitor.status === 'number') return String(monitor.status)
  if (monitor.active === true) return 'active'

  return 'unknown'
}

function uptimeKumaNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)

  return Number.isFinite(n) ? n : null
}

function uptimeKumaChildIds(monitor: UptimeKumaMonitor): number[] {
  if (!Array.isArray(monitor.childrenIDs)) return []

  return monitor.childrenIDs.map(uptimeKumaNumber).filter((id): id is number => id != null)
}

function uptimeKumaMonitorWeight(monitor: UptimeKumaMonitor): number {
  return uptimeKumaNumber(monitor.weight) ?? monitor.id
}

function uptimeKumaMonitorTarget(monitor: UptimeKumaMonitor, childCount?: number): string {
  if (monitor.type === 'group') {
    const count = childCount ?? uptimeKumaChildIds(monitor).length

    return count > 0 ? `${String(count)} monitors` : ''
  }

  const url = typeof monitor.url === 'string' ? monitor.url.trim() : ''

  if (url === 'http://' || url === 'https://') return ''

  return url
}

export type UptimeKumaMonitorRow = {
  key: string
  id: number
  name: string
  type: string
  target: string
  status: string
  interval: number | null
  retryInterval: number | null
  depth: number
  isGroup: boolean
  searchText: string
}

export function buildUptimeKumaMonitorRows(monitors: UptimeKumaMonitor[]): UptimeKumaMonitorRow[] {
  const byId = new Map<number, UptimeKumaMonitor>()

  for (const monitor of monitors) byId.set(monitor.id, monitor)

  const childrenByParent = new Map<number, UptimeKumaMonitor[]>()

  for (const monitor of monitors) {
    const parentId = uptimeKumaNumber(monitor.parent)

    if (parentId == null || !byId.has(parentId)) continue
    const siblings = childrenByParent.get(parentId) ?? []

    siblings.push(monitor)
    childrenByParent.set(parentId, siblings)
  }

  const compareMonitor = (a: UptimeKumaMonitor, b: UptimeKumaMonitor) => {
    const weightDelta = uptimeKumaMonitorWeight(a) - uptimeKumaMonitorWeight(b)

    return weightDelta !== 0 ? weightDelta : a.id - b.id
  }

  const orderedChildren = (monitor: UptimeKumaMonitor) => {
    const childIds = uptimeKumaChildIds(monitor)
    const used = new Set<number>()
    const children: UptimeKumaMonitor[] = []

    for (const id of childIds) {
      const child = byId.get(id)

      if (!child) continue
      children.push(child)
      used.add(id)
    }
    const inferred = (childrenByParent.get(monitor.id) ?? [])
      .filter((child) => !used.has(child.id))
      .sort(compareMonitor)

    return [...children, ...inferred]
  }

  const rows: UptimeKumaMonitorRow[] = []
  const visited = new Set<number>()
  const append = (monitor: UptimeKumaMonitor, depth: number) => {
    if (visited.has(monitor.id)) return
    visited.add(monitor.id)
    const children = orderedChildren(monitor)
    const type = monitor.type || 'http'
    const target = uptimeKumaMonitorTarget(monitor, children.length)
    const status = uptimeKumaMonitorStatus(monitor)
    const name = monitor.name || String(monitor.id)
    const pathName = typeof monitor.pathName === 'string' ? monitor.pathName : ''

    rows.push({
      key: String(monitor.id),
      id: monitor.id,
      name,
      type,
      target,
      status,
      interval:
        type === 'group' ? null : typeof monitor.interval === 'number' ? monitor.interval : null,
      retryInterval:
        type === 'group'
          ? null
          : typeof monitor.retryInterval === 'number'
            ? monitor.retryInterval
            : null,
      depth,
      isGroup: type === 'group',
      searchText: `${String(monitor.id)} ${name} ${pathName} ${type} ${target} ${status}`,
    })
    for (const child of children) append(child, depth + 1)
  }

  const roots = monitors
    .filter((monitor) => {
      const parentId = uptimeKumaNumber(monitor.parent)

      return parentId == null || !byId.has(parentId)
    })
    .sort(compareMonitor)

  for (const root of roots) append(root, 0)
  for (const monitor of [...monitors].sort(compareMonitor)) append(monitor, 0)

  return rows
}
