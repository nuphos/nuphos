import clsx from 'clsx'

import { IntegrationPlatformIcon } from './IntegrationPlatformIcon'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { MouseEvent } from 'react'

type CursorPoint = { clientX: number; clientY: number }
type OpenGroup = (rows: IntegrationPlatformRow[], event: CursorPoint) => void
type OpenContextMenu = (row: IntegrationPlatformRow, event: CursorPoint) => void

function InstalledConnector({
  rows,
  onOpenGroup,
  onContextMenu,
}: {
  rows: IntegrationPlatformRow[]
  onOpenGroup: OpenGroup
  onContextMenu: OpenContextMenu
}) {
  const row = rows[0]
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    if (rows.length === 1) {
      row.onAction?.()

      return
    }
    const rect = event.currentTarget.getBoundingClientRect()

    onOpenGroup(rows, { clientX: rect.left, clientY: rect.bottom })
  }

  return (
    <button
      type="button"
      title={
        rows.length === 1 ? `${row.account} · ${row.status}` : `${String(rows.length)} connections`
      }
      aria-label={`${row.provider}, ${String(rows.length)} ${rows.length === 1 ? 'connection' : 'connections'}`}
      onClick={open}
      onContextMenu={(event) => {
        event.preventDefault()
        if (rows.length === 1) onContextMenu(row, event)
        else onOpenGroup(rows, event)
      }}
      className={clsx(
        'group relative flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-zGray-800/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.07)] transition-colors',
        row.onAction ? 'hover:border-zGray-700 hover:bg-zGray-850' : 'cursor-default',
      )}
    >
      <IntegrationPlatformIcon provider={row.provider} size={20} />
      {rows.length > 1 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-zGray-200 px-1 text-[9px] font-medium leading-none text-white shadow-sm">
          {rows.length}
        </span>
      )}
    </button>
  )
}

export function InstalledList({
  loading,
  rows,
  filter,
  onOpenGroup,
  onContextMenu,
}: {
  loading: boolean
  rows: IntegrationPlatformRow[]
  filter: string
  onOpenGroup: OpenGroup
  onContextMenu: OpenContextMenu
}) {
  if (loading) {
    return (
      <>
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="h-10 w-10 animate-pulse rounded-xl border border-zGray-800 bg-zGray-850"
          />
        ))}
      </>
    )
  }
  if (rows.length > 0) {
    const groups = new Map<IntegrationPlatformRow['provider'], IntegrationPlatformRow[]>()

    for (const row of rows) {
      const group = groups.get(row.provider)

      if (group) group.push(row)
      else groups.set(row.provider, [row])
    }

    return (
      <>
        {[...groups].map(([provider, group]) => (
          <InstalledConnector
            key={provider}
            rows={group}
            onOpenGroup={onOpenGroup}
            onContextMenu={onContextMenu}
          />
        ))}
      </>
    )
  }

  return (
    <p className="text-[12px] text-tertiary">
      {filter.trim()
        ? 'No installed connectors match this search.'
        : 'No connectors installed yet.'}
    </p>
  )
}
