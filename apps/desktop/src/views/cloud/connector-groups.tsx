import { t } from '../../i18n'

import { IntegrationPlatformIcon } from './IntegrationPlatformIcon'

import type { IntegrationPlatformRow } from './team-home-bind'

export function ConnectorGroups({
  rows,
  sharing,
  onOpen,
  mode,
}: {
  rows: IntegrationPlatformRow[]
  mode: 'mine' | 'shared'
  sharing: Record<string, { owned: boolean; shared: boolean }> | undefined
  onOpen: (rows: IntegrationPlatformRow[]) => void
}) {
  const groups = [
    {
      key: 'mine',
      title: t('Connections'),
      rows: rows.filter((row) => sharing?.[row.key]?.owned),
    },
    {
      key: 'shared',
      title: t('Shared with the team'),
      rows: rows.filter((row) => sharing?.[row.key]?.shared),
    },
    { key: 'shared', title: t('Installed'), rows: rows.filter((row) => !sharing?.[row.key]) },
  ]

  return (
    <>
      {groups
        .filter((group) => group.key === mode && group.rows.length > 0)
        .map((group) => (
          <section key={group.title} className="mb-6">
            <h2 className="border-b border-line-control/55 pb-2.5 text-[13px] font-medium text-main">
              {group.title}
            </h2>
            <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-2">
              {group.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => onOpen([row])}
                  className="flex items-center gap-3 rounded-lg border border-line-control/55 px-4 py-3 text-left hover:bg-state-hover"
                >
                  <IntegrationPlatformIcon provider={row.provider} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-main">{row.account}</span>
                    <span className="block truncate text-[12px] text-secondary">
                      {row.principal}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
    </>
  )
}
