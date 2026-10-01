import type { MongoCollectionSummary } from '../../types'

export type DetailTab =
  'Documents' | 'Schema' | 'Indexes' | 'Validation' | 'View' | 'Sharding' | 'Options'

export const SYSTEM_DATABASES = new Set(['admin', 'config', 'local'])

export function formatBytes(value: number | null): string {
  if (value === null) return '—'
  if (value < 1_024) return `${String(value)} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`

  return `${(value / 1_073_741_824).toFixed(1)} GB`
}

export function formatCount(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat().format(value)
}

export function typeLabel(type: MongoCollectionSummary['type']): string {
  if (type === 'timeseries') return 'Time series'

  return type === 'view' ? 'View' : 'Collection'
}
