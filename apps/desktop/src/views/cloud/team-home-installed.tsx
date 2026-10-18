import clsx from 'clsx'

import { Tooltip } from '../../components/ui/tooltip'
import { CONNECTOR_INFO_LABELS } from '../../lib/appRoutes'

import { CONNECTOR_HOVER } from './connector-actions'
import { IntegrationPlatformIcon } from './IntegrationPlatformIcon'

import type { IntegrationPlatformRow } from './team-home-bind'

type OpenConnector = (rows: IntegrationPlatformRow[]) => void

function InstalledConnector({
  rows,
  onOpen,
}: {
  rows: IntegrationPlatformRow[]
  onOpen: OpenConnector
}) {
  const row = rows[0]
  const name = CONNECTOR_INFO_LABELS[row.provider]
  const attention = rows.find((item) => item.attention)?.attention
  const count = rows.length === 1 ? row.account : `${String(rows.length)} connections`
  const detail = attention ? `${count} · ${attention}` : count

  return (
    <Tooltip
      side="top"
      content={
        <span className="block text-center">
          <span className="block font-medium">{name}</span>
          <span className="block opacity-70">{detail}</span>
        </span>
      }
    >
      <button
        type="button"
        aria-label={`Open ${name}, ${detail}`}
        onClick={() => onOpen(rows)}
        className={clsx(
          'relative flex h-11 w-11 flex-none items-center justify-center rounded-lg outline-none',
          CONNECTOR_HOVER,
        )}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zGray-800/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <IntegrationPlatformIcon provider={row.provider} size={20} />
        </span>
        {attention && (
          <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-warning" />
        )}
        {rows.length > 1 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-zGray-200 px-1 text-[9px] font-medium leading-none text-zGray-900 shadow-sm">
            {rows.length}
          </span>
        )}
      </button>
    </Tooltip>
  )
}

export function InstalledList({
  loading,
  rows,
  filter,
  onOpen,
}: {
  loading: boolean
  rows: IntegrationPlatformRow[]
  filter: string
  onOpen: OpenConnector
}) {
  if (loading) {
    return (
      <>
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="flex h-11 w-11 items-center justify-center">
            <div className="h-9 w-9 animate-pulse rounded-lg border border-zGray-800 bg-zGray-850" />
          </div>
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
          <InstalledConnector key={provider} rows={group} onOpen={onOpen} />
        ))}
      </>
    )
  }

  return (
    <p className="px-1 text-[12px] text-tertiary">
      {filter.trim()
        ? 'No installed connectors match this search.'
        : 'No connectors installed yet.'}
    </p>
  )
}
