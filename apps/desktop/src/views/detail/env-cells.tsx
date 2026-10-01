import clsx from 'clsx'
import { ArrowUpRight } from 'lucide-react'

import type { DetailTarget } from './target'
import type { ReactNode } from 'react'

export function ReadOnlyEditableCell({
  children,
  onEdit,
  align = 'left',
}: {
  children: ReactNode
  onEdit: () => void
  align?: 'left' | 'center'
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onEdit()
      }}
      className={clsx(
        'block h-8 w-full min-w-0 rounded px-1.5 text-[13px] hover:bg-zGray-800/70',
        align === 'center' ? 'text-center' : 'text-left',
      )}
    >
      {children}
    </button>
  )
}

// Small "jump to resource" affordance shown next to a ConfigMap/Secret name in
// the env editor. Clicking it drills into that resource's detail view instead of
// entering the cell editor (which the surrounding ReadOnlyEditableCell owns).
export function EnvRefNavButton({
  kind,
  namespace,
  name,
  onNavigate,
}: {
  kind: 'ConfigMap' | 'Secret'
  namespace: string
  name: string
  onNavigate?: (target: DetailTarget) => void
}) {
  if (!onNavigate || !name.trim()) return null

  return (
    <button
      type="button"
      title={`Open ${kind} ${name}`}
      aria-label={`Open ${kind} ${name}`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onNavigate({ kind, namespace, name })
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-tertiary hover:bg-zGray-800 hover:text-main"
    >
      <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )
}
