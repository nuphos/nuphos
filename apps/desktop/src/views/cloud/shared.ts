export type CommonProps = {
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function applyFilter<T>(items: T[], filter: string, getText: (item: T) => string) {
  if (!filter) return items
  const f = filter.toLowerCase()

  return items.filter((x) => getText(x).toLowerCase().includes(f))
}

export function formatBytes(n: number): string {
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log10(n) / 3), units.length - 1)
  const v = n / 1000 ** i

  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function basename(prefix: string): string {
  const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const idx = trimmed.lastIndexOf('/')

  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}
