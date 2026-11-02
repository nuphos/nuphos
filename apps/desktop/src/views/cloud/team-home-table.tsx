import clsx from 'clsx'
import { useMemo } from 'react'

import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import { CATALOG } from '../addIntegrationCatalog'

import { CatalogLogo } from './catalog-logo'
import { CONNECTOR_HOVER } from './connector-actions'
import { ConnectorSearch } from './connector-search'
import { githubConnectedSummary, visibleGithubInstallations } from './github-installation-display'
import { OverflowMarquee } from './overflow-marquee'
import { InstalledList } from './team-home-installed'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { GithubInstallation } from '../../types'
import type { AddIntegrationKey, CatalogItem } from '../addIntegrationCatalog'

/** One catalog row. The whole row opens the connector: its detail view once connected, the add flow before. */
function CatalogConnector({
  item,
  installed,
  connectedSummary,
  onAdd,
  onOpen,
}: {
  item: CatalogItem
  installed: IntegrationPlatformRow[]
  connectedSummary: ConnectedSummary | null
  onAdd: (key: AddIntegrationKey) => void
  onOpen: (rows: IntegrationPlatformRow[]) => void
}) {
  const connected = installed.length > 0
  const open = () => {
    if (connected) onOpen(installed)
    else onAdd(item.key)
  }

  return (
    <div
      onClick={open}
      className={clsx(
        'group flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5',
        CONNECTOR_HOVER,
      )}
    >
      <button
        type="button"
        aria-label={
          connected ? t('Open {name}', { name: item.name }) : t('Add {name}', { name: item.name })
        }
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:shadow-none focus-visible:!outline-none"
      >
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-zGray-800/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <CatalogLogo provider={item.key} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-main">{item.name}</span>
          {connectedSummary ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-secondary/80">
              <Tooltip content={connectedSummary.attention ? t('Needs attention') : t('Connected')}>
                <span
                  className={clsx(
                    'h-1.5 w-1.5 flex-none rounded-full',
                    connectedSummary.attention ? 'bg-warning' : 'bg-success',
                  )}
                />
              </Tooltip>
              <span className="sr-only">
                {connectedSummary.attention ? t('Needs attention:') : t('Connected:')}{' '}
              </span>
              <OverflowMarquee text={connectedSummary.text} className="min-w-0" />
            </span>
          ) : (
            <OverflowMarquee
              text={item.description}
              className="mt-0.5 text-[12px] text-secondary/80"
            />
          )}
        </span>
      </button>
      <span className="flex h-7 w-[76px] flex-none items-center justify-center rounded-lg border border-zGray-750 bg-zGray-900 text-[12px] font-medium text-secondary transition-colors group-hover:border-zGray-650 group-hover:text-main">
        {connected ? t('Manage') : t('Add')}
      </span>
    </div>
  )
}

type ConnectedSummary = { text: string; attention: boolean }

function summarizeConnection(
  item: CatalogItem,
  installed: IntegrationPlatformRow[],
  githubInstallations: GithubInstallation[],
): ConnectedSummary | null {
  if (installed.length === 0) return null
  const needing = installed.filter((row) => row.attention)

  if (needing.length > 0) {
    const text =
      installed.length === 1
        ? `${installed[0].account} · ${String(needing[0].attention)}`
        : t('{n} of {total} connections need attention', {
            n: needing.length,
            total: installed.length,
          })

    return { text, attention: true }
  }
  if (item.key === 'github') {
    const github = visibleGithubInstallations(
      githubInstallations,
      installed.map((row) => row.key),
    )

    if (github.length > 0) return { text: githubConnectedSummary(github), attention: false }
  }

  return {
    text:
      installed.length === 1 ? installed[0].account : t('{n} connections', { n: installed.length }),
    attention: false,
  }
}

export function IntegrationCatalog({
  rows,
  visibleRows,
  githubInstallations,
  loading,
  filter,
  onFilterChange,
  onAdd,
  onOpen,
}: {
  rows: IntegrationPlatformRow[]
  visibleRows: IntegrationPlatformRow[]
  githubInstallations: GithubInstallation[]
  loading: boolean
  filter: string
  onFilterChange: (filter: string) => void
  onAdd: (key: AddIntegrationKey) => void
  onOpen: (rows: IntegrationPlatformRow[]) => void
}) {
  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const installedKeys = useMemo(() => new Set<string>(rows.map((row) => row.provider)), [rows])
  const visibleCategories = CATALOG.map((category) => ({
    ...category,
    items: category.items.filter((item) => terms.every((term) => item.haystack.includes(term))),
  })).filter((category) => category.items.length > 0)

  return (
    <div className="connector-quiet-focus flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-7 py-9 selectable">
        <header className="mb-8">
          <h1 className="text-[24px] font-medium tracking-[-0.025em] text-main">
            {t('Connectors')}
          </h1>
          <p className="mb-5 mt-1.5 text-[13.5px] text-secondary">
            {t('Connect Nuphos to your code, data, cloud, and everyday tools.')}
          </p>
          <ConnectorSearch
            filter={filter}
            onFilterChange={onFilterChange}
            installed={installedKeys}
            onPick={(item) => {
              const installed = rows.filter((row) => row.provider === item.key)

              if (installed.length > 0) onOpen(installed)
              else onAdd(item.key)
            }}
          />
        </header>
        {/* A search with no installed match skips this section, so only one empty message shows. */}
        {(loading || visibleRows.length > 0 || terms.length === 0) && (
          <section>
            <h2 className="border-b border-zGray-800/55 pb-2.5 text-[13px] font-medium text-main">
              {t('Installed')}
            </h2>
            <div className="flex min-h-[76px] flex-wrap items-center gap-2 py-4">
              <InstalledList loading={loading} rows={visibleRows} filter={filter} onOpen={onOpen} />
            </div>
          </section>
        )}

        {visibleCategories.length > 0 ? (
          <div className="space-y-8 pt-4">
            {visibleCategories.map((category) => (
              <section key={category.id}>
                <h2 className="mb-1.5 border-b border-zGray-800/55 pb-2.5 text-[13px] font-medium text-main">
                  {category.title}
                </h2>
                <div className="-mx-2 grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
                  {category.items.map((item) => {
                    const installed = rows.filter((row) => row.provider === item.key)

                    return (
                      <CatalogConnector
                        key={item.key}
                        item={item}
                        installed={installed}
                        connectedSummary={summarizeConnection(item, installed, githubInstallations)}
                        onAdd={onAdd}
                        onOpen={onOpen}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex min-h-44 items-center justify-center text-[12.5px] text-tertiary">
            {t('No connectors match “{query}”.', { query: filter.trim() })}
          </div>
        )}
      </div>
    </div>
  )
}
