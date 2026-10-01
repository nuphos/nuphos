import { QueryError } from './QueryError'

import type { ReactNode } from 'react'

type Props = {
  title: string
  loading?: boolean
  error?: string | null
  actions?: ReactNode
  children: ReactNode
}

export function PanelFrame({ title, loading, error, actions, children }: Props) {
  return (
    <div className="h-full flex flex-col outline outline-1 outline-zGray-800/60">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zGray-800/60">
        <div className="text-[12.5px] font-medium text-secondary truncate">
          {title || 'Untitled'}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {actions}
          {loading && (
            <div className="w-3 h-3 rounded-full border-2 border-zGray-700 border-t-zViolet-accent animate-spin" />
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        {error ? (
          // inset-0 + overflow-auto keeps a failure inside its own panel
          // whatever the message turns out to be.
          <div className="absolute inset-0 overflow-auto px-3 py-2.5 scrollbar-thin">
            <QueryError message={error} />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
