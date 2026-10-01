import { ChevronRight, ExternalLink, Plus, Unplug } from 'lucide-react'

import { api } from '../../api'
import { CloudLogo } from '../../components/CloudLogo'
import { LinearMark } from '../../components/LinearMark'
import { toast } from '../../components/ui/toast'
import { CATALOG } from '../addIntegrationCatalog'

import type { ConnectorInfo } from './types'
import type { ConnectorInfoProvider } from '../../lib/appRoutes'
import type { ReactNode } from 'react'

export type ConnectorInfoAction = {
  label: string
  onOpen: () => void
  kind?: 'primary' | 'secondary'
}

function ConnectorLogo({ provider, size }: { provider: ConnectorInfoProvider; size: number }) {
  if (provider === 'linear') return <LinearMark size={size} />

  return <CloudLogo provider={provider} size={size} />
}

function ConnectionDetails({
  info,
  providerLabel,
  actions,
  onDisconnect,
}: {
  info: ConnectorInfo
  providerLabel: string
  actions: ConnectorInfoAction[]
  onDisconnect?: () => void
}) {
  const externalUrl = info.externalUrl
  const hasActions = actions.length > 0 || Boolean(externalUrl) || Boolean(onDisconnect)

  return (
    <div className="border-t border-zGray-800/55 bg-zGray-950/15 px-4 pb-5 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[12px] font-medium text-secondary">Connection details</h3>
        {hasActions && (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onOpen}
                className={
                  action.kind === 'primary'
                    ? 'flex h-8 items-center rounded-lg bg-zGray-50 px-3 text-[12.5px] font-medium text-zGray-950 transition-colors hover:bg-zGray-150'
                    : 'flex h-8 items-center rounded-lg border border-zGray-800/60 bg-surface px-3 text-[12.5px] font-medium text-secondary transition-colors hover:bg-zGray-850 hover:text-main'
                }
              >
                {action.label}
              </button>
            ))}
            {externalUrl && (
              <button
                type="button"
                onClick={() => {
                  void api
                    .appOpenExternal(externalUrl)
                    .catch(() => toast.error(`Could not open ${providerLabel}`))
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-zGray-800/60 bg-surface px-3 text-[12.5px] font-medium text-secondary transition-colors hover:bg-zGray-850 hover:text-main"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
                {info.externalLabel}
              </button>
            )}
            {onDisconnect && (
              <button
                type="button"
                onClick={onDisconnect}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/5 px-3 text-[12.5px] font-medium text-red-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10"
              >
                <Unplug className="h-3.5 w-3.5" strokeWidth={1.9} />
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>
      <dl className="mt-4 space-y-3">
        {info.fields.map((field) => (
          <div key={field.label} className="grid grid-cols-[112px_minmax(0,1fr)] gap-4">
            <dt className="text-[12px] leading-5 text-tertiary">{field.label}</dt>
            <dd
              className={
                field.mono
                  ? 'break-all font-mono text-[11.5px] leading-5 text-secondary'
                  : 'min-w-0 break-words text-[12.5px] leading-5 text-main'
              }
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function ConnectorInfoPage({
  provider,
  providerLabel,
  connections,
  selectedId,
  onSelect,
  onDisconnect,
  addAction,
}: {
  provider: ConnectorInfoProvider
  providerLabel: string
  connections: {
    id: string
    info: ConnectorInfo
    inAppActions?: ConnectorInfoAction[]
    details?: ReactNode
    canDisconnect?: boolean
  }[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDisconnect: (id: string, name: string) => void
  addAction?: { label: string; onClick: () => void }
}) {
  const catalogItem = CATALOG.flatMap((category) => category.items).find(
    (item) => item.key === provider,
  )
  const description = catalogItem?.description ?? `${providerLabel} connector for Nuphos.`

  return (
    <div className="mx-auto w-full max-w-[760px] px-7 py-10">
      <header>
        <div className="flex h-14 w-14 items-center justify-center rounded-[14px] border border-zGray-800/60 bg-surface shadow-sm">
          <ConnectorLogo provider={provider} size={31} />
        </div>

        <div className="mt-5 min-w-0">
          <div className="min-w-0">
            <h1 className="text-[20px] font-medium leading-tight tracking-[-0.015em] text-main">
              {providerLabel}
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-tertiary">{description}</p>
          </div>
        </div>
      </header>

      <section className="mt-10">
        <div className="flex items-center justify-between border-b border-zGray-800/55 pb-2.5">
          <h2 className="text-[13.5px] font-medium text-main">Connections</h2>
          <div className="flex items-center gap-3">
            <span className="text-[11.5px] text-tertiary">
              {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
            </span>
            {addAction && (
              <button
                type="button"
                onClick={addAction.onClick}
                className="flex h-7 items-center gap-1 rounded-lg border border-zGray-800/60 bg-surface px-2.5 text-[12px] font-medium text-secondary transition-colors hover:bg-zGray-850 hover:text-main"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                {addAction.label}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {connections.map((connection) => {
            const isSelected = connection.id === selectedId

            return (
              <div
                key={connection.id}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  isSelected
                    ? 'border-zGray-700/70 bg-surface shadow-sm'
                    : 'border-transparent hover:border-zGray-800/55 hover:bg-zGray-900/40'
                }`}
              >
                <button
                  type="button"
                  aria-expanded={isSelected}
                  onClick={() => onSelect(isSelected ? null : connection.id)}
                  className="flex w-full items-center gap-3 px-3 py-3.5 text-left"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-zGray-800/55 bg-surface">
                    <ConnectorLogo provider={provider} size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-main">
                      {connection.info.name}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-tertiary">
                      {providerLabel} connection
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full border border-zGray-800/55 bg-surface px-2.5 py-1 text-[11.5px] text-secondary">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Connected
                  </div>
                  <ChevronRight
                    className={`h-4 w-4 flex-none text-tertiary transition-transform duration-200 ${
                      isSelected ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                <div
                  aria-hidden={!isSelected}
                  inert={!isSelected}
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                    isSelected ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <ConnectionDetails
                      info={connection.info}
                      providerLabel={providerLabel}
                      actions={connection.inAppActions ?? []}
                      onDisconnect={
                        connection.canDisconnect
                          ? () => onDisconnect(connection.id, connection.info.name)
                          : undefined
                      }
                    />
                    {connection.details && (
                      <div className="border-t border-zGray-800/55 bg-zGray-950/15 px-4 py-5">
                        {connection.details}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
