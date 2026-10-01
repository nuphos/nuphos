import type { ReactNode } from 'react'

export function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="text-[11px] uppercase tracking-wide text-tertiary">{label}</div>
      {children}
    </section>
  )
}

export function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
          <div className="text-tertiary">{label}</div>
          <div className="text-secondary break-words font-mono text-[11.5px]">{value}</div>
        </div>
      ))}
    </div>
  )
}
