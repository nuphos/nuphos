import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Optional leading visual (e.g. a connector logo) shown left of the title. */
  leading?: ReactNode
}

export function PageHeader({ title, subtitle, actions, leading }: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-zGray-800/60 flex-shrink-0 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {leading && <div className="flex-shrink-0">{leading}</div>}
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-main truncate">{title}</div>
          {subtitle && <div className="text-[11.5px] text-tertiary truncate">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}
