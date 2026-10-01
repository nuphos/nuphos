import { HeartPulse, Loader2, Network, Plug, RefreshCw } from 'lucide-react'

import { DatabaseEngineIcon } from '../../components/DatabaseEngineIcon'
import { SectionHeader } from '../../components/SectionHeader'
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
              Test connection
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 @sm:grid-cols-3">
        <Stat label="Engine" value={databaseEngineLabel(connection.engine)} />
        <Stat label="Environment" value={connection.environment} />
        <Stat label="Database" value={connection.databaseName ?? 'Default'} mono />
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
          title="Connection"
          hint="How Nuphos reaches this database"
        />
        <Row label="Network" value={connection.networkMode} />
        <Row label="TLS" value={connection.tls.enabled ? connection.tls.mode : 'Disabled'} />
        <Row
          label="Credential capability"
          value={
            connection.health.readOnly === 'writable'
              ? 'Write capable upstream binding'
              : connection.health.readOnly === 'verified'
                ? 'Read only'
                : 'Unverified'
          }
        />
      </section>
      <section className="border-t border-zGray-800/60 px-6 py-4">
        <SectionHeader
          icon={<HeartPulse className="h-4 w-4 text-zViolet-accent" strokeWidth={1.8} />}
          title="Health"
          hint={checked ? `Checked ${checked}` : undefined}
        />
        <Row label="Status" value={connection.health.status} />
        <Row label="Latency" value={`${String(connection.health.latencyMs)} ms`} />
        <Row label="Server" value={connection.health.serverVersion ?? 'Unknown'} />
      </section>
      <section className="border-t border-zGray-800/60 px-6 py-4">
        <SectionHeader
          icon={<Network className="h-4 w-4 text-zViolet-accent" strokeWidth={1.8} />}
          title="Related resources"
          hint={
            connection.relations.length
              ? `${String(connection.relations.length)} linked`
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
          <EmptyLine text="No service, deployment, cluster, or repository relations yet." />
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
