import type { ReactNode } from 'react'

/** Heading row for one block inside an expanded runtime: a small caps label,
 *  an optional hint, and room for a control on the right. */
export function PanelHeading({
  title,
  hint,
  right,
}: {
  title: string
  hint?: string
  right?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">{title}</h4>
        {hint && <p className="mt-0.5 text-xs text-tertiary/80">{hint}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

export function PanelStat({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] text-tertiary">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] text-main">{children}</dd>
    </div>
  )
}
