import { Button } from '../../components/ui/button'
import { t } from '../../i18n'
import { nameOf } from '../settings/personalCredentials'
import { PersonalCredentialsSection } from '../settings/PersonalCredentialsSection'

import type { AtlasTeam, PersonalCredentialProvider } from '../../types'
import type { AddIntegrationKey } from '../addIntegrationCatalog'
import type { IntegrationPlatformRow } from './team-home-bind'

export function ConnectorServiceDetail({
  team,
  personalProvider,
  rows,
  sharing,
  onOpen,
  onAdd,
  onOpenSettingsSection,
  error,
  retry,
}: {
  team: AtlasTeam | undefined
  personalProvider: PersonalCredentialProvider
  rows: IntegrationPlatformRow[]
  sharing: Record<string, { owned: boolean; shared: boolean }> | undefined
  onOpen: (rows: IntegrationPlatformRow[]) => void
  onAdd: (key: AddIntegrationKey) => void
  onOpenSettingsSection: (section: string) => void
  error: boolean
  retry: () => unknown
}) {
  const connections = rows.filter((row) => row.provider === personalProvider)
  const groups = [
    {
      title: t('My connections'),
      rows: connections.filter((row) => sharing?.[row.key]?.owned && !sharing[row.key].shared),
    },
    {
      title: t('Shared with the team'),
      rows: connections.filter((row) => sharing?.[row.key]?.shared),
    },
    { title: t('Installed'), rows: connections.filter((row) => !sharing?.[row.key]) },
  ]

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-8 pt-2 selectable">
      <h1 className="mb-6 text-[24px] font-medium tracking-[-0.025em] text-main">
        {nameOf(personalProvider)}
      </h1>
      <h2 className="mb-3 text-[13px] font-medium text-main">{t('My connections')}</h2>
      <p className="mb-3 text-[12px] text-secondary">{t('Only me')}</p>
      {team && (
        <PersonalCredentialsSection
          team={team}
          provider={personalProvider}
          hideHeading
          onOpenSection={onOpenSettingsSection}
        />
      )}
      {groups.map(
        (group) =>
          group.rows.length > 0 && (
            <section key={group.title} className="mt-8">
              <h2 className="mb-3 text-[13px] font-medium text-main">{group.title}</h2>
              <div className="space-y-2">
                {group.rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => onOpen([row])}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-line-control px-4 py-3 text-left hover:bg-state-hover"
                  >
                    <span className="text-[13.5px] font-medium text-main">{row.account}</span>
                    <span className="text-[12px] text-secondary">{t('Manage')}</span>
                  </button>
                ))}
              </div>
            </section>
          ),
      )}
      {(personalProvider === 'github' || personalProvider === 'linear') && (
        <Button className="mt-4" variant="secondary" onClick={() => onAdd(personalProvider)}>
          {t('Add a connector')}
        </Button>
      )}
      {error && <Button onClick={() => void retry()}>{t('Retry')}</Button>}
      {!team && !error && <p role="status">{t('Loading...')}</p>}
    </div>
  )
}
