import { Braces, Eye, Loader2, Table2 } from 'lucide-react'

import type { MongoCollectionSummary } from '../../types'

export function CollectionGlyph({ type }: { type: MongoCollectionSummary['type'] }) {
  if (type === 'view') return <Eye className="h-4 w-4 text-secondary" />
  if (type === 'timeseries') return <Braces className="h-4 w-4 text-zViolet-accent" />

  return <Table2 className="h-4 w-4 text-[#47A248]" />
}

export function JsonPanel({ value, empty }: { value: unknown; empty: string }) {
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0))
    return <EmptyDetail text={empty} />

  return (
    <pre className="overflow-x-auto rounded-lg border border-zGray-800 bg-zGray-900 p-3 text-[10.5px] leading-5 text-secondary">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zGray-800 p-3">
      <div className="text-[10px] uppercase tracking-wide text-tertiary">{label}</div>
      <div className="mt-1 text-[12px] text-secondary">{value}</div>
    </div>
  )
}

export function EmptyDetail({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-zGray-800 text-[11.5px] text-tertiary">
      {text}
    </div>
  )
}

export function SafetyNotice({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div
      className={`${compact ? 'mx-2 mt-2' : 'mb-3'} rounded-md border border-warning/25 bg-warning/5 px-2.5 py-2 text-[10.5px] leading-4 text-warning`}
    >
      {text}
    </div>
  )
}

export function CenteredLoader() {
  return (
    <div className="flex h-[500px] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-tertiary" />
    </div>
  )
}
