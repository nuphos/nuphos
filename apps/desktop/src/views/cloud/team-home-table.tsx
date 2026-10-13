import clsx from 'clsx'
import { MoreHorizontal } from 'lucide-react'

import { CloudLogo } from '../../components/CloudLogo'
import { DatabaseEngineGlyph } from '../../components/DatabaseEngineIcon'
import { LinearMark } from '../../components/LinearMark'
import { SearchBox } from '../../components/Toolbar'
import { CATALOG } from '../addIntegrationCatalog'

import { installedConnectorAddAction } from './connector-actions'
import { InstalledList } from './team-home-installed'

import type { BindMode } from './connector-actions'
import type { AddIntegrationKey, CatalogItem } from '../addIntegrationCatalog'
import type { IntegrationPlatformRow } from './team-home-bind'

function CatalogLogo({ provider }: { provider: AddIntegrationKey }) {
  if (provider === 'linear') return <LinearMark size={20} />
  if (provider === 'mongodb') {
    return <DatabaseEngineGlyph engine="mongodb" className="h-5 w-5" />
  }

  return <CloudLogo provider={provider} size={20} />
}

function CatalogConnector({
  item,
  installed,
  onAdd,
  onOpenGroup,
  onContextMenu,
}: {
  item: CatalogItem
  installed: IntegrationPlatformRow[]
  onAdd: (key: AddIntegrationKey, mode?: BindMode) => void
  onOpenGroup: (rows: IntegrationPlatformRow[], event: { clientX: number; clientY: number }) => void
  onContextMenu: (row: IntegrationPlatformRow, event: { clientX: number; clientY: number }) => void
}) {
  const first = installed.length > 0 ? installed[0] : null
  const addAction = first ? installedConnectorAddAction(item.key) : null

  return (
    <div
      className={clsx(
        'group flex min-w-0 items-center gap-3 rounded-lg px-1.5 py-3 transition-colors',
        first?.onAction && 'hover:bg-zGray-850',
      )}
      onClick={(event) => {
        if (installed.length > 1) onOpenGroup(installed, event)
        else first?.onAction?.()
      }}
      onContextMenu={(event) => {
        if (!first) return
        event.preventDefault()
        if (installed.length > 1) onOpenGroup(installed, event)
        else onContextMenu(first, event)
      }}
    >
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-zGray-800/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <CatalogLogo provider={item.key} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-main">{item.name}</div>
        <div className="mt-0.5 truncate text-[12px] text-secondary/80">{item.description}</div>
      </div>
      {addAction && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onAdd(item.key, addAction.mode)
          }}
          className="flex-none rounded-lg border border-zGray-750 bg-zGray-900 px-3 py-1 text-[12px] font-medium text-secondary transition-colors hover:border-zGray-650 hover:bg-zGray-850 hover:text-main"
        >
          {addAction.label}
        </button>
      )}
      {first ? (
        <button
          type="button"
          aria-label={`Manage ${item.name}`}
          title={`Manage ${item.name}`}
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()

            if (installed.length > 1) {
              onOpenGroup(installed, { clientX: rect.right, clientY: rect.bottom })
            } else {
              onContextMenu(first, { clientX: rect.right, clientY: rect.bottom })
            }
          }}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-tertiary opacity-0 transition-colors hover:bg-zGray-800 hover:text-main group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onAdd(item.key)
          }}
          className="flex-none rounded-lg border border-zGray-750 bg-zGray-900 px-3 py-1 text-[12px] font-medium text-secondary transition-colors hover:border-zGray-650 hover:bg-zGray-850 hover:text-main"
        >
          Add
        </button>
      )}
    </div>
  )
}

export function IntegrationCatalog({
  rows,
  visibleRows,
  loading,
  filter,
  onFilterChange,
  onAdd,
  onOpenInstalledGroup,
  onRowContextMenu,
}: {
  rows: IntegrationPlatformRow[]
  visibleRows: IntegrationPlatformRow[]
  loading: boolean
  filter: string
  onFilterChange: (filter: string) => void
  onAdd: (key: AddIntegrationKey, mode?: BindMode) => void
  onOpenInstalledGroup: (
    rows: IntegrationPlatformRow[],
    event: { clientX: number; clientY: number },
  ) => void
  onRowContextMenu: (
    row: IntegrationPlatformRow,
    event: { clientX: number; clientY: number },
  ) => void
}) {
  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visibleCategories = CATALOG.map((category) => ({
    ...category,
    items: category.items.filter((item) => terms.every((term) => item.haystack.includes(term))),
  })).filter((category) => category.items.length > 0)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-7 py-9 selectable">
        <header className="mb-9">
          <h1 className="text-[24px] font-medium tracking-[-0.025em] text-main">Connectors</h1>
          <p className="mb-5 mt-1.5 text-[13.5px] text-secondary">
            Connect Nuphos to your code, data, cloud, and everyday tools.
          </p>
          <div className="[&>div]:h-8 [&>div]:rounded-lg [&>div]:border [&>div]:border-zGray-800/55 [&>div]:bg-transparent">
            <SearchBox
              filter={filter}
              onFilterChange={onFilterChange}
              fill
              label="Search connectors"
            />
          </div>
        </header>
        <section>
          <div className="flex items-center justify-between border-b border-zGray-800/55 pb-3">
            <h2 className="text-[13px] font-medium text-main">Installed</h2>
          </div>
          <div className="flex min-h-[76px] flex-wrap items-center gap-3.5 py-5">
            <InstalledList
              loading={loading}
              rows={visibleRows}
              filter={filter}
              onOpenGroup={onOpenInstalledGroup}
              onContextMenu={onRowContextMenu}
            />
          </div>
        </section>

        {visibleCategories.length > 0 ? (
          <div className="space-y-10 pt-4">
            {visibleCategories.map((category) => (
              <section key={category.id}>
                <h2 className="border-b border-zGray-800/55 pb-3 text-[13px] font-medium text-main">
                  {category.title}
                </h2>
                <div className="mt-1.5 grid grid-cols-1 gap-x-7 sm:grid-cols-2">
                  {category.items.map((item) => (
                    <CatalogConnector
                      key={item.key}
                      item={item}
                      installed={rows.filter((row) => row.provider === item.key)}
                      onAdd={onAdd}
                      onOpenGroup={onOpenInstalledGroup}
                      onContextMenu={onRowContextMenu}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex min-h-44 items-center justify-center text-[12.5px] text-tertiary">
            No connectors match “{filter.trim()}”.
          </div>
        )}
      </div>
    </div>
  )
}
