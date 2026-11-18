import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import { CATALOG } from '../addIntegrationCatalog'
import { matchingPersonalConnectors } from '../settings/personalCredentials'
import { PersonalCredentialsSection } from '../settings/PersonalCredentialsSection'

import { CatalogLogo } from './catalog-logo'
import { CONNECTOR_HOVER } from './connector-actions'
import { ConnectorGroups } from './connector-groups'
import { ConnectorSearch } from './connector-search'
import { searchTerms } from './connector-suggestions'
import { githubConnectedSummary, visibleGithubInstallations } from './github-installation-display'
import { OverflowMarquee } from './overflow-marquee'
import { PersonalConnectors } from './personal-connectors'
import { InstalledList } from './team-home-installed'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { PersonalCredentialProvider, GithubInstallation } from '../../types'
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
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line-control/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <CatalogLogo provider={item.key} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-main">{item.name}</span>
          {connectedSummary ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-secondary">
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
              className="mt-0.5 text-[12px] text-secondary"
            />
          )}
        </span>
      </button>
      <span className="flex h-7 w-[76px] flex-none items-center justify-center rounded-lg border border-line-control bg-surface-sheet text-[12px] font-medium text-secondary transition-colors group-hover:border-line-control group-hover:text-main">
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
  teamId,
  rows,
  visibleRows,
  githubInstallations,
  loading,
  filter,
  onFilterChange,
  onAdd,
  onOpen,
  onOpenSettingsSection,
}: {
  teamId: string
  rows: IntegrationPlatformRow[]
  visibleRows: IntegrationPlatformRow[]
  githubInstallations: GithubInstallation[]
  loading: boolean
  filter: string
  onFilterChange: (filter: string) => void
  onAdd: (key: AddIntegrationKey) => void
  onOpen: (rows: IntegrationPlatformRow[]) => void
  onOpenSettingsSection: (section: string) => void
}) {
  const [catalogTab, setCatalogTab] = useState<'mine' | 'shared' | 'browse'>('browse')
  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const installedKeys = useMemo(() => new Set<string>(rows.map((row) => row.provider)), [rows])
  const visibleCategories = CATALOG.map((category) => ({
    ...category,
    items: category.items.filter((item) => terms.every((term) => item.haystack.includes(term))),
  })).filter((category) => category.items.length > 0)
  const personal = useMemo(() => matchingPersonalConnectors(searchTerms(filter)), [filter])
  const [personalProvider, setPersonalProvider] = useState<PersonalCredentialProvider | null>(null)
  const teamQuery = useQuery({
    queryKey: ['personal-connectors-team', teamId],
    queryFn: async () => {
      const teams = await api.atlasListTeams()
      const team = teams.find((item) => item.id === teamId)

      if (!team) throw new Error('Team is unavailable')

      return team
    },
    enabled: personalProvider !== null,
  })
  const sharingQuery = useQuery({
    queryKey: ['connector-sharing', teamId, rows.map((row) => row.key).join(',')],
    queryFn: () => api.atlasListTeamConnectors(teamId),
  })
  const sharing = sharingQuery.data?.sharing
  const openPersonalCredentials = (provider: PersonalCredentialProvider) =>
    setPersonalProvider(provider)

  if (personalProvider)
    return (
      <div className="flex-1 overflow-y-auto px-8 pb-8 pt-2 selectable">
        <Button variant="ghost" size="sm" onClick={() => setPersonalProvider(null)}>
          {t('Back')}
        </Button>
        {teamQuery.data ? (
          <PersonalCredentialsSection
            team={teamQuery.data}
            provider={personalProvider}
            onOpenSection={onOpenSettingsSection}
          />
        ) : null}
        {!teamQuery.data && teamQuery.isError && (
          <Button onClick={() => void teamQuery.refetch()}>{t('Retry')}</Button>
        )}
        {!teamQuery.data && !teamQuery.isError && <p role="status">{t('Loading...')}</p>}
      </div>
    )

  return (
    <div className="connector-quiet-focus flex-1 overflow-y-auto">
      <div className="w-full px-8 pb-8 pt-2 selectable">
        <header className="mb-8">
          {catalogTab !== 'browse' && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-3"
              onClick={() => setCatalogTab('browse')}
            >
              <span aria-hidden="true">← </span>
              {t('Connectors')}
            </Button>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 pr-12">
            <h1 className="text-[24px] font-medium tracking-[-0.025em] text-main">
              {catalogTab === 'browse' ? t('Connectors') : t('Manage connections')}
            </h1>
            {catalogTab === 'browse' && (
              <Button variant="secondary" onClick={() => setCatalogTab('mine')}>
                {t('Manage connections')}
                <span aria-hidden="true"> →</span>
              </Button>
            )}
          </div>
          <p className="mb-5 mt-1.5 text-[13.5px] text-secondary">
            {t('Connect Nuphos to your code, data, cloud, and everyday tools.')}
          </p>
          <ConnectorSearch
            filter={filter}
            onFilterChange={onFilterChange}
            installed={installedKeys}
            personal={personal}
            onPickPersonal={openPersonalCredentials}
            onPick={(item) => {
              const installed = rows.filter((row) => row.provider === item.key)

              if (installed.length > 0) onOpen(installed)
              else onAdd(item.key)
            }}
          />
          {catalogTab !== 'browse' && (
            <div className="mt-5 flex gap-2">
              {(['mine', 'shared'] as const).map((tab) => (
                <Button
                  key={tab}
                  variant={catalogTab === tab ? 'secondary' : 'ghost'}
                  aria-pressed={catalogTab === tab}
                  onClick={() => setCatalogTab(tab)}
                >
                  {tab === 'mine' && t('My connections')}
                  {tab === 'shared' && t('Shared with the team')}
                </Button>
              ))}
            </div>
          )}
        </header>
        {catalogTab === 'mine' && (
          <PersonalConnectors
            teamId={teamId}
            items={personal}
            onOpenAccount={openPersonalCredentials}
            connectedOnly
          />
        )}
        {catalogTab !== 'browse' && (
          <ConnectorGroups rows={visibleRows} sharing={sharing} onOpen={onOpen} mode={catalogTab} />
        )}
        {loading && <InstalledList loading rows={[]} filter={filter} onOpen={onOpen} />}

        {catalogTab === 'browse' && (visibleCategories.length > 0 || personal.length > 0) ? (
          <div className="space-y-8 pt-4">
            {personal.length > 0 && (
              <PersonalConnectors
                teamId={teamId}
                items={personal}
                onOpenAccount={openPersonalCredentials}
              />
            )}
            {visibleCategories.map((category) => (
              <section key={category.id}>
                <h2 className="mb-1.5 border-b border-line-control/55 pb-2.5 text-[13px] font-medium text-main">
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
        ) : catalogTab === 'browse' ? (
          <div className="flex min-h-44 items-center justify-center text-[12.5px] text-tertiary">
            {t('No connectors match “{query}”.', { query: filter.trim() })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
