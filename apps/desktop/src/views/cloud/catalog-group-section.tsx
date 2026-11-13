import { useState } from 'react'

import { t } from '../../i18n'

import { summarizeConnection } from './catalog-connection-summary'
import { CatalogConnector } from './catalog-connector'

import type { CatalogGroup } from './catalog-groups'
import type { IntegrationPlatformRow } from './team-home-bind'
import type { GithubInstallation } from '../../types'
import type { AddIntegrationKey } from '../addIntegrationCatalog'

/** Three rows of two: a longer group shows the rest on View all. */
export const PREVIEW_COUNT = 6

/** One group of the catalog: its title, then its connectors in two columns. */
export function CatalogGroupSection({
  group,
  searching,
  rows,
  githubInstallations,
  onAdd,
  onOpen,
}: {
  group: CatalogGroup
  searching: boolean
  rows: IntegrationPlatformRow[]
  githubInstallations: GithubInstallation[]
  onAdd: (key: AddIntegrationKey) => void
  onOpen: (rows: IntegrationPlatformRow[]) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // A search shows every match; otherwise a long group shows its first rows.
  const long = !searching && group.items.length > PREVIEW_COUNT
  const items = long && !expanded ? group.items.slice(0, PREVIEW_COUNT) : group.items

  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between border-b border-line-control/55 pb-2.5">
        <h2 className="text-[13px] font-medium text-main">{group.title}</h2>
        {long && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="text-[12px] text-tertiary transition-colors hover:text-main"
          >
            {expanded ? t('Show less') : t('View all')}
          </button>
        )}
      </div>
      <div className="-mx-2 grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
        {items.map((item) => {
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
  )
}
