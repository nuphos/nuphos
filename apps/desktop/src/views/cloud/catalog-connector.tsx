import clsx from 'clsx'

import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'

import { CatalogLogo } from './catalog-logo'
import { CONNECTOR_HOVER } from './connector-actions'
import { OverflowMarquee } from './overflow-marquee'

import type { ConnectedSummary } from './catalog-connection-summary'
import type { IntegrationPlatformRow } from './team-home-bind'
import type { AddIntegrationKey, CatalogItem } from '../addIntegrationCatalog'

/** One catalog row. The whole row opens the connector: its detail view once connected, the add flow before. */
export function CatalogConnector({
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
