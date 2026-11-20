import { useQuery } from '@tanstack/react-query'
import { useContext, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'
import { CATALOG } from '../addIntegrationCatalog'
import { credentialFor, matchingPersonalConnectors, nameOf } from '../settings/personalCredentials'

import { CatalogConnector } from './CatalogConnector'
import { ConnectorGroups } from './connector-groups'
import { ConnectorHeaderContext } from './connector-header'
import { connectionOwnership } from './connector-ownership'
import { ConnectorSearch } from './connector-search'
import { searchTerms } from './connector-suggestions'
import { ConnectorServiceDetail } from './ConnectorServiceDetail'
import { githubConnectedSummary, visibleGithubInstallations } from './github-installation-display'
import { PersonalConnectors } from './personal-connectors'
import { InstalledList } from './team-home-installed'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { PersonalCredentialProvider, GithubInstallation } from '../../types'
import type { AddIntegrationKey, CatalogItem } from '../addIntegrationCatalog'

function summarizeConnection(
  item: CatalogItem,
  installed: IntegrationPlatformRow[],
  githubInstallations: GithubInstallation[],
): { text: string; attention: boolean } | null {
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
    personalItems: matchingPersonalConnectors(terms).filter(
      ({ provider }) =>
        (category.id === 'messaging' && provider === 'gmail') ||
        (category.id === 'document' && provider === 'google-drive') ||
        (category.id === 'project-management' && provider === 'google-calendar'),
    ),
  })).filter((category) => category.items.length > 0 || category.personalItems.length > 0)
  const personal = useMemo(() => matchingPersonalConnectors(searchTerms(filter)), [filter])
  const [personalProvider, setPersonalProvider] = useState<PersonalCredentialProvider | null>(null)
  const credentialsQuery = useQuery({
    queryKey: ['catalog-personal-credentials', personalProvider],
    queryFn: () => api.atlasListPersonalCredentials(),
  })
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
  const setHeader = useContext(ConnectorHeaderContext)

  useEffect(() => {
    setHeader?.({
      title: personalProvider
        ? nameOf(personalProvider)
        : catalogTab === 'browse'
          ? t('Connectors')
          : t('Manage connections'),
      back: personalProvider
        ? () => setPersonalProvider(null)
        : catalogTab !== 'browse'
          ? () => setCatalogTab('browse')
          : undefined,
      manage:
        !personalProvider && catalogTab === 'browse' ? () => setCatalogTab('mine') : undefined,
    })

    return () => setHeader?.(null)
  }, [setHeader, catalogTab, personalProvider])
  const openPersonalCredentials = (provider: PersonalCredentialProvider) =>
    setPersonalProvider(provider)

  if (personalProvider)
    return (
      <ConnectorServiceDetail
        team={teamQuery.data}
        personalProvider={personalProvider}
        rows={rows}
        sharing={sharing}
        onOpen={onOpen}
        onAdd={onAdd}
        onOpenSettingsSection={onOpenSettingsSection}
        error={teamQuery.isError}
        retry={() => teamQuery.refetch()}
      />
    )

  return (
    <div className="connector-quiet-focus flex-1 overflow-y-auto">
      <div className="w-full px-6 pb-8 pt-2 selectable">
        <header className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-[24px] font-medium tracking-[-0.025em] text-main">
              {catalogTab === 'browse' ? t('Connectors') : t('Manage connections')}
            </h1>
            {catalogTab === 'browse' && (
              <Button className="-mr-2" variant="secondary" onClick={() => setCatalogTab('mine')}>
                {t('Manage connections')}
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
            personal={personal.filter(
              (item) =>
                item.provider === 'gmail' ||
                item.provider === 'google-drive' ||
                item.provider === 'google-calendar',
            )}
            onPickPersonal={openPersonalCredentials}
            onPick={(item) => {
              const installed = rows.filter((row) => row.provider === item.key)

              if (item.key === 'github' || item.key === 'linear') openPersonalCredentials(item.key)
              else if (installed.length > 0) onOpen(installed)
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
            hideHeading
          />
        )}
        {catalogTab !== 'browse' && (
          <ConnectorGroups
            rows={visibleRows.filter(
              (row) =>
                catalogTab !== 'mine' ||
                !(
                  (row.provider === 'github' || row.provider === 'linear') &&
                  credentialFor(credentialsQuery.data ?? null, row.provider, teamId)
                ),
            )}
            sharing={sharing}
            onOpen={onOpen}
            mode={catalogTab}
          />
        )}
        {loading && <InstalledList loading rows={[]} filter={filter} onOpen={onOpen} />}

        {catalogTab === 'browse' && (visibleCategories.length > 0 || personal.length > 0) ? (
          <div className="space-y-8 pt-4">
            {visibleCategories.map((category) => (
              <section key={category.id}>
                <h2 className="mb-1.5 border-b border-line-control/55 pb-2.5 text-[13px] font-medium text-main">
                  {category.title}
                </h2>
                <div className="-mx-2 grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
                  {category.items.map((item) => {
                    const installed = rows.filter((row) => row.provider === item.key)

                    const personalProvider =
                      item.key === 'github' || item.key === 'linear' ? item.key : null
                    const own =
                      personalProvider &&
                      credentialFor(credentialsQuery.data ?? null, personalProvider, teamId)
                    const summary = summarizeConnection(item, installed, githubInstallations)

                    return (
                      <CatalogConnector
                        key={item.key}
                        item={item}
                        installed={installed}
                        connectedSummary={
                          own
                            ? {
                                text: installed.length
                                  ? t('{n} connections', { n: installed.length + 1 })
                                  : `${t('Only me')} · ${own.login}`,
                                attention: summary?.attention ?? false,
                              }
                            : summary
                        }
                        sharingSummary={connectionOwnership(installed, sharing, own ? 1 : 0)}
                        onActivate={
                          personalProvider
                            ? () => openPersonalCredentials(personalProvider)
                            : undefined
                        }
                        onAdd={onAdd}
                        onOpen={onOpen}
                      />
                    )
                  })}
                </div>
                {category.personalItems.length > 0 && (
                  <PersonalConnectors
                    hideHeading
                    teamId={teamId}
                    items={category.personalItems}
                    onOpenAccount={openPersonalCredentials}
                  />
                )}
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
