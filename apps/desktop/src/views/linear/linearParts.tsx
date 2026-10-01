import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'

import { normalizeHexColor } from './linearColor'

import type { LinearIssueState } from '../../types'
import type { ReactNode } from 'react'

export function ColorDot({ color }: { color: string | null | undefined }) {
  const hex = normalizeHexColor(color)

  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full bg-zGray-500"
      style={hex ? { backgroundColor: hex } : undefined}
    />
  )
}

export function StateBadge({ state }: { state: LinearIssueState }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-zGray-800/60 px-2 py-0.5 text-[11.5px] font-medium text-secondary"
      title={state.type}
    >
      <ColorDot color={state.color} />
      {state.name}
    </span>
  )
}

export function Timestamp({ value }: { value: string }) {
  const date = new Date(value)

  return (
    <time
      dateTime={value}
      title={Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()}
      className="text-tertiary"
    >
      {relativeTimeFromNow(value)}
    </time>
  )
}

export function LinearPageMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-[12.5px] text-secondary">
      {children}
    </div>
  )
}
