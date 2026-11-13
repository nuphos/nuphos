import { useMemo } from 'react'

import { t } from '../../i18n'
import { CATALOG } from '../addIntegrationCatalog'
import {
  PERSONAL_CREDENTIALS_SECTION,
  matchingPersonalConnectors,
} from '../settings/personalCredentials'

import { CatalogGroupSection } from './catalog-group-section'
import { groupCatalog } from './catalog-groups'
import { ConnectorSearch } from './connector-search'
import { searchTerms } from './connector-suggestions'
import { PersonalConnectors } from './personal-connectors'
import { InstalledList } from './team-home-installed'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { GithubInstallation } from '../../types'
import type { AddIntegrationKey } from '../addIntegrationCatalog'

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
  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const installedKeys = useMemo(() => new Set<string>(rows.map((row) => row.provider)), [rows])
  const visibleCategories = CATALOG.map((category) => ({
    ...category,
    items: category.items.filter((item) => terms.every((term) => item.haystack.includes(term))),
  })).filter((category) => category.items.length > 0)
  const visibleGroups = groupCatalog(visibleCategories)
  const personal = useMemo(() => matchingPersonalConnectors(searchTerms(filter)), [filter])
  const openPersonalCredentials = () => onOpenSettingsSection(PERSONAL_CREDENTIALS_SECTION)

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
            personal={personal}
            onPickPersonal={openPersonalCredentials}
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
            <h2 className="border-b border-line-control/55 pb-2.5 text-[13px] font-medium text-main">
              {t('Installed')}
            </h2>
            <div className="flex min-h-[76px] flex-wrap items-center gap-2 py-4">
              <InstalledList loading={loading} rows={visibleRows} filter={filter} onOpen={onOpen} />
            </div>
          </section>
        )}

        {visibleGroups.length > 0 || personal.length > 0 ? (
          <div className="space-y-8 pt-4">
            {personal.length > 0 && (
              <PersonalConnectors
                teamId={teamId}
                items={personal}
                onOpenSettings={openPersonalCredentials}
              />
            )}
            {visibleGroups.map((group) => (
              <CatalogGroupSection
                key={group.id}
                group={group}
                searching={terms.length > 0}
                rows={rows}
                githubInstallations={githubInstallations}
                onAdd={onAdd}
                onOpen={onOpen}
              />
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
