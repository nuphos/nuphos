import { AlertTriangle, CheckCircle2, Database, Loader2 } from 'lucide-react'

import { useReportVisibleError } from '../../components/VisibleErrorReporter'

import type { DatabaseConnection } from '../../types'

export function HealthBadge({ connection }: { connection: DatabaseConnection }) {
  const ok = connection.health.status === 'healthy'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] ${ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {connection.health.status}
    </span>
  )
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zGray-800/70 py-2 text-[12px] last:border-0">
      <span className="text-tertiary">{label}</span>
      <span className="break-all text-right text-secondary">{value}</span>
    </div>
  )
}

export function ProviderResourceCard({ connection }: { connection: DatabaseConnection }) {
  const origin = connection.providerOrigin!
  const capabilities = [
    ['Catalog', origin.capabilities.catalog],
    ['Read-only query', origin.capabilities.query],
    ['Monitoring', origin.capabilities.monitoring],
    ['Governed changes', origin.capabilities.changes],
    ['Backup / restore', origin.capabilities.backupRestore],
    ['Parameters', origin.capabilities.parameters],
  ] as const

  return (
    <section className="mt-4 rounded-xl border border-zGray-800 bg-zGray-900/30 p-4">
      <h2 className="text-[13px] font-medium text-main">Provider resource</h2>
      <p className="mt-1 text-[11.5px] leading-5 text-tertiary">
        This lightweight resource resolves the active Cloudflare connector on every request. No API
        token or connection string is copied into Databases.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-x-6 md:grid-cols-2">
        <Row label="Provider" value="Cloudflare D1" />
        <Row label="Account" value={origin.accountName ?? origin.accountId} />
        <Row label="Region" value={origin.region ?? 'Provider managed'} />
        <Row label="External resource" value={origin.externalResourceId} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {capabilities.map(([label, supported]) => (
          <span
            key={label}
            className={`rounded-full border px-2 py-0.5 text-[10.5px] ${supported ? 'border-success/30 bg-success/5 text-success' : 'border-zGray-800 bg-zGray-900 text-tertiary'}`}
          >
            {label}: {supported ? 'available' : 'unavailable'}
          </span>
        ))}
      </div>
    </section>
  )
}

export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zGray-700 px-6 py-12 text-center">
      <Database className="mx-auto h-7 w-7 text-tertiary" />
      <div className="mt-3 text-[14px] text-main">{title}</div>
      <p className="mx-auto mt-1 max-w-lg text-[12.5px] leading-5 text-tertiary">{body}</p>
    </div>
  )
}

export function Stat({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[10.5px] font-medium uppercase tracking-wider text-tertiary">
        {label}
      </div>
      <div className={`truncate text-[12px] text-main${mono ? ' font-mono' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}

export function EmptyLine({ text }: { text: string }) {
  return <div className="py-5 text-center text-[12px] text-tertiary">{text}</div>
}

export function Loading() {
  return (
    <div className="flex h-full min-h-64 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-tertiary" />
    </div>
  )
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void | Promise<void>
}) {
  useReportVisibleError(message, 'database_connection_error_block')

  return (
    <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-[12px] text-error">
      <div>{message}</div>
      <button
        onClick={() => void onRetry()}
        className="mt-2 text-secondary underline hover:text-main"
      >
        Try again
      </button>
    </div>
  )
}
