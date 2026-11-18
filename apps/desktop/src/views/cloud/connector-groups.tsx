import { t } from '../../i18n'
import { CONNECTOR_INFO_LABELS } from '../../lib/appRoutes'

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
  const services = new Map<IntegrationPlatformRow['provider'], IntegrationPlatformRow[]>()

  for (const row of rows) {
    const access = sharing?.[row.key]
    const visible = mode === 'mine' ? access?.owned : !access || access.shared

    if (!visible) continue
    const group = services.get(row.provider)

    if (group) group.push(row)
    else services.set(row.provider, [row])
  }
  if (services.size === 0) return null

  return (
    <section className="mb-6">
      <h2 className="border-b border-line-control/55 pb-2.5 text-[13px] font-medium text-main">
        {mode === 'mine' ? t('Connections') : t('Installed')}
      </h2>
      <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-2">
        {[...services].map(([provider, connections]) => (
          <button
            key={provider}
            type="button"
            onClick={() => onOpen(connections)}
            className="flex items-center gap-3 rounded-lg border border-line-control/55 px-4 py-3 text-left hover:bg-state-hover"
          >
            <IntegrationPlatformIcon provider={provider} size={22} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-main">
                {CONNECTOR_INFO_LABELS[provider]}
              </span>
              <span className="block text-[12px] text-secondary">
                {t('{n} connections', { n: connections.length })}
              </span>
            </span>
            <span aria-hidden="true" className="text-tertiary">
              →
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
