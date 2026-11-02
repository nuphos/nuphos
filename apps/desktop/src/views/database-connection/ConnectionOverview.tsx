import { HeartPulse, Loader2, Network, Plug, RefreshCw } from 'lucide-react'

import { DatabaseEngineIcon } from '../../components/DatabaseEngineIcon'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { databaseEngineLabel } from '../../lib/databaseEngine'

import { EmptyLine, HealthBadge, ProviderResourceCard, Row, Stat } from './ConnectionBits'

import type { DatabaseConnection } from '../../types'

export function ConnectionHeader({
  connection,
  busy,
  isTeamAdmin,
  onTest,
}: {
  connection: DatabaseConnection
  busy: boolean
  isTeamAdmin: boolean
  onTest: () => void
}) {
  return (
    <section className="px-6 py-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <DatabaseEngineIcon engine={connection.engine} className="h-5 w-5" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-main">{connection.name}</div>
            <div className="truncate font-mono text-[11px] text-tertiary">
              {connection.endpoint}
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <HealthBadge connection={connection} />
          {isTeamAdmin && (
            <button
              onClick={onTest}
              disabled={busy}
              className="flex h-7 items-center gap-1.5 rounded-md border border-zGray-700 px-2.5 text-[12px] text-secondary hover:text-main disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t('Test connection')}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 @sm:grid-cols-3">
        <Stat label={t('Engine')} value={databaseEngineLabel(connection.engine)} />
        <Stat label={t('Environment')} value={connection.environment} />
        <Stat label={t('Database')} value={connection.databaseName ?? t('Default')} mono />
      </div>
    </section>
  )
}

export function OverviewSection({
  connection,
  checked,
}: {
  connection: DatabaseConnection
  checked: string
}) {
  return (
    <>
      <section className="border-t border-zGray-800/60 px-6 py-4">
        <SectionHeader
          icon={<Plug className="h-4 w-4 text-zViolet-accent" strokeWidth={1.8} />}
          title={t('Connection')}
          hint={t('How Nuphos reaches this database')}
        />
        <Row label={t('Network')} value={connection.networkMode} />
        <Row label="TLS" value={connection.tls.enabled ? connection.tls.mode : t('Disabled')} />
        <Row
          label={t('Credential capability')}
          value={
            connection.health.readOnly === 'writable'
              ? t('Write capable upstream binding')
              : connection.health.readOnly === 'verified'
                ? t('Read only')
                : t('Unverified')
          }
        />
      </section>
      <section className="border-t border-zGray-800/60 px-6 py-4">
        <SectionHeader
          icon={<HeartPulse className="h-4 w-4 text-zViolet-accent" strokeWidth={1.8} />}
          title={t('Health')}
          hint={checked ? t('Checked {time}', { time: checked }) : undefined}
        />
        <Row label={t('Status')} value={connection.health.status} />
        <Row label={t('Latency')} value={`${String(connection.health.latencyMs)} ms`} />
        <Row label={t('Server')} value={connection.health.serverVersion ?? t('Unknown')} />
      </section>
      <section className="border-t border-zGray-800/60 px-6 py-4">
        <SectionHeader
          icon={<Network className="h-4 w-4 text-zViolet-accent" strokeWidth={1.8} />}
          title={t('Related resources')}
          hint={
            connection.relations.length
              ? t('{n} linked', { n: connection.relations.length })
              : undefined
          }
        />
        {connection.relations.length ? (
          connection.relations.map((relation) => (
            <Row
              key={`${relation.kind}:${relation.id}`}
              label={relation.kind}
              value={relation.label ?? relation.id}
            />
          ))
        ) : (
          <EmptyLine text={t('No service, deployment, cluster, or repository relations yet.')} />
        )}
      </section>
      {connection.providerOrigin && (
        <div className="border-t border-zGray-800/60 px-6 py-4">
          <ProviderResourceCard connection={connection} />
        </div>
      )}
    </>
  )
}
