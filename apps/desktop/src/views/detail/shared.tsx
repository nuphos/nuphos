import clsx from 'clsx'
import { Box } from 'lucide-react'

import { Age } from '../../components/Age'
import { PodStatus } from '../../components/K8sHealth'
import { healthClass } from '../../lib/k8sHealth'

import type { PodDetail } from '../../types'
import type { HealthTone } from '../../lib/k8sHealth'
import type { ReactNode } from 'react'

export function SkeletonLine({ className }: { className: string }) {
  return <div className={clsx('rounded bg-zGray-800/70 animate-pulse', className)} />
}

export function SkeletonField() {
  return (
    <div>
      <SkeletonLine className="h-3 w-16" />
      <SkeletonLine className="mt-2 h-3 w-32" />
    </div>
  )
}

export function ContainerCard({
  c,
  selected = false,
  onSelect,
}: {
  c: PodDetail['containers'][number]
  selected?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={onSelect ? selected : undefined}
      className={clsx(
        'min-w-0 rounded-lg border bg-zGray-900 p-3.5 text-left',
        onSelect && 'transition-colors hover:border-zGray-700 hover:bg-zGray-850',
        selected ? 'border-zViolet-500/50 ring-1 ring-zViolet-500/20' : 'border-zGray-800',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={clsx(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
            c.is_init || c.is_ephemeral
              ? 'bg-zGray-800 text-secondary ring-zGray-700'
              : 'bg-zViolet-500/10 text-zViolet-accent ring-zViolet-500/15',
          )}
        >
          <Box className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[12.5px] font-semibold text-main">{c.name}</span>
            {(c.is_init || c.is_ephemeral) && (
              <span className="text-[10px] text-tertiary">{c.is_init ? 'init' : 'ephemeral'}</span>
            )}
          </div>
          <div className="truncate font-mono text-[10.5px] text-tertiary" title={c.image}>
            {c.image}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-zGray-800 pt-3 text-[11.5px]">
        <PodStatus status={c.status} ready={c.ready ? '1/1' : '0/1'} />
        {c.started && <span className="text-secondary">Started</span>}
        {c.status === 'Running' && (
          <span className={c.ready ? 'text-success' : 'text-error'}>
            {c.ready ? 'Ready' : 'Not ready'}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Restarts" value={String(c.restarts)} />
        <Stat label="Reason" value={c.restart_reason ?? '-'} />
        <Stat label="Last Restart" value={c.last_restart ? <Age value={c.last_restart} /> : '-'} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zGray-800 pt-3 text-[11.5px]">
        <ResourceStat label="CPU" request={c.cpu_request} limit={c.cpu_limit} />
        <ResourceStat label="Memory" request={c.memory_request} limit={c.memory_limit} />
      </div>
    </button>
  )
}

export function ResourceStat({
  label,
  request,
  limit,
}: {
  label: string
  request: string | null
  limit: string | null
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-tertiary">{label}</div>
      <div className="mt-0.5 text-[11.5px] text-secondary">Requests: {request ?? '-'}</div>
      <div className="text-[11.5px] text-secondary">Limits: {limit ?? '-'}</div>
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  if (!label) return <div />

  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-tertiary">{label}</div>
      <div className="text-secondary mt-0.5">{value}</div>
    </div>
  )
}

export function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
      {children}
    </div>
  )
}

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-1">{label}</div>
      <div className="text-[12.5px] text-main">{value}</div>
    </div>
  )
}

export function OverviewSection({
  title,
  meta,
  children,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="min-w-0 bg-zGray-950">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-zGray-800 px-6 py-3">
        <h2 className="text-[13px] font-semibold text-main">{title}</h2>
        {meta && <div className="min-w-0 text-[12px] text-tertiary">{meta}</div>}
      </div>
      {children}
    </section>
  )
}

export type OverviewChip = { label: string; title?: string; tone?: HealthTone }

export function OverviewChipList({
  chips,
  empty = '-',
}: {
  chips: OverviewChip[]
  empty?: string
}) {
  if (chips.length === 0) return <span className="text-tertiary">{empty}</span>

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip.label}:${String(index)}`}
          className={clsx(
            'max-w-full truncate rounded bg-zGray-800 px-1.5 py-0.5 font-mono text-[11.5px]',
            chip.tone ? healthClass[chip.tone] : 'text-secondary',
          )}
          title={chip.title ?? chip.label}
        >
          {chip.label}
        </span>
      ))}
    </div>
  )
}

export function WorkloadMetric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'default' | 'good' | 'warning' | 'error' | 'neutral'
}) {
  const toneClass = (() => {
    if (tone === 'good') return 'text-success'
    if (tone === 'warning') return 'text-warning'
    if (tone === 'error') return 'text-error'
    if (tone === 'neutral') return 'text-secondary'

    return 'text-main'
  })()

  return (
    <div className="min-w-0 bg-zGray-900 px-6 py-3">
      <div className="mb-1 text-[10.5px] uppercase tracking-wider text-tertiary">{label}</div>
      <div
        className={clsx('min-w-0 truncate text-[14px] font-semibold', toneClass)}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
      {detail && (
        <div className="mt-0.5 min-w-0 truncate text-[11.5px] text-tertiary">{detail}</div>
      )}
    </div>
  )
}

export function OverviewRailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pt-4 first:pt-0">
      <div className="mb-2 text-[10.5px] uppercase tracking-wider text-tertiary">{title}</div>
      {children}
    </div>
  )
}
