import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { K8sStatus as StatusBadge } from '../../components/K8sHealth'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'
import { formatCpu, formatMemory } from '../../utils'
import { useResetOnKey } from '../useResetOnKey'

import { CollapsibleChips, ConditionChip, NodeUtilizationCard } from './node-cards'
import { NODE_POD_COLUMNS } from './node-pod-columns'
import { Section, Field, SkeletonField, SkeletonLine } from './shared'

import type { DetailTarget } from './target'
import type { NodeDetail, PodItem } from '../../types'

export function NodeOverview({
  name,
  refreshKey,
  onNavigate,
}: {
  name: string
  refreshKey: number
  onNavigate?: (target: DetailTarget) => void
}) {
  const context = useRequiredKubeContext()
  // Seeding from the cache in the initializer makes a revisit's very first
  // frame the cached snapshot (no skeleton flash). Correct because the call
  // site keys this component by context+name, so node switches remount.
  const cacheKey = `node-detail:${context}|${name}`
  const [data, setData] = useState<NodeDetail | null>(
    () => readSwrCache<NodeDetail>(cacheKey) ?? null,
  )
  // First-load failure: error details go to the global toast; the page
  // degrades to a neutral "Unavailable" placeholder (an endless skeleton
  // would read as still-loading).
  const [failed, setFailed] = useState(false)

  // Stale-while-revalidate: a revisited node paints its last snapshot
  // immediately while the fresh detail loads; with a snapshot on screen a
  // failed reload degrades to a console warning instead of a toast.
  useResetOnKey(cacheKey, () => {
    setData(readSwrCache<NodeDetail>(cacheKey) ?? null)
    setFailed(false)
  })

  useEffect(() => {
    let cancelled = false
    const cached = readSwrCache<NodeDetail>(cacheKey)

    api
      .getNodeDetail(context, name)
      .then((d) => {
        if (cancelled) return
        writeSwrCache(cacheKey, d)
        setFailed(false)
        setData(d)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (cached) {
          console.warn('[node-detail] refresh failed; keeping cached data:', String(e))
        } else {
          setFailed(true)
          toast.apiError('Could not load node details', e)
        }
      })

    return () => {
      cancelled = true
    }
  }, [context, name, cacheKey, refreshKey])

  if (!data) {
    return failed ? (
      <div className="p-6 text-tertiary text-[13px]">Unavailable</div>
    ) : (
      <NodeOverviewSkeleton />
    )
  }

  const dash = <span className="text-tertiary">-</span>
  const mono = (v: string | null) => (v ? <span className="font-mono text-[12px]">{v}</span> : dash)

  return (
    <div className="p-6 space-y-5">
      <Section>
        <Field label="Age" value={<Age value={data.age} />} />
        <Field label="Status" value={<StatusBadge status={data.status} />} />
        <Field label="Roles" value={data.roles.length ? data.roles.join(', ') : dash} />
        <Field
          label="Schedulable"
          value={data.schedulable ? 'Yes' : <span className="text-warning">No (cordoned)</span>}
        />
        <Field label="Labels" value={<CollapsibleChips entries={data.labels} />} />
        <Field
          label="Annotations"
          value={<CollapsibleChips entries={data.annotations} keyOnly />}
        />
      </Section>

      <Section>
        <Field label="OS Image" value={data.os_image || dash} />
        <Field label="Kernel" value={data.kernel_version || dash} />
        <Field label="Kubelet Version" value={data.kubelet_version || dash} />
        <Field label="Kube-proxy Version" value={data.kube_proxy_version || dash} />
        <Field label="Hostname" value={mono(data.hostname)} />
        <Field label="Internal IP" value={mono(data.internal_ip)} />
        <Field label="External IP" value={mono(data.external_ip)} />
      </Section>

      <div>
        <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-2">Conditions</div>
        {data.conditions.length === 0 ? (
          <span className="text-tertiary text-[12.5px]">-</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.conditions.map((c) => (
              <ConditionChip key={c.type} c={c} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-2">Taints</div>
        {data.taints.length === 0 ? (
          <span className="text-tertiary text-[12.5px]">-</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.taints.map((t, i) => (
              <span
                key={`${t.key}:${String(i)}`}
                className="bg-zGray-800 px-1.5 py-0.5 rounded text-[11.5px] text-secondary font-mono"
              >
                {t.key}
                {t.value ? `=${t.value}` : ''}:{t.effect}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-[14px] font-semibold mb-2 text-main">Utilization</h3>
        <div className="grid grid-cols-1 @lg:grid-cols-2 gap-3">
          <NodeUtilizationCard title="CPU" meter={data.utilization.cpu} format={formatCpu} />
          <NodeUtilizationCard
            title="Memory"
            meter={data.utilization.memory}
            format={formatMemory}
          />
        </div>
      </div>

      <NodeScheduledPods
        pods={data.scheduled_pods}
        capacity={data.pods_capacity}
        onNavigate={onNavigate}
      />
    </div>
  )
}

// Mirrors NodeOverview's real layout (field sections, condition chips,
// utilization cards, scheduled-pods table) so nothing jumps when data lands.
function NodeOverviewSkeleton() {
  return (
    <div className="p-6 space-y-5">
      <Section>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonField key={i} />
        ))}
      </Section>
      <Section>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonField key={i} />
        ))}
      </Section>
      {['Conditions', 'Taints'].map((title) => (
        <div key={title}>
          <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-2">{title}</div>
          <div className="flex gap-1.5">
            <SkeletonLine className="h-5 w-20" />
            <SkeletonLine className="h-5 w-24" />
          </div>
        </div>
      ))}
      <div>
        <h3 className="text-[14px] font-semibold mb-2 text-main">Utilization</h3>
        <div className="grid grid-cols-1 @lg:grid-cols-2 gap-3">
          <SkeletonLine className="h-[96px]" />
          <SkeletonLine className="h-[96px]" />
        </div>
      </div>
      <div>
        <h3 className="text-[14px] font-semibold mb-2 text-main">Scheduled Pods</h3>
        <SkeletonLine className="h-[160px]" />
      </div>
    </div>
  )
}

function NodeScheduledPods({
  pods,
  capacity,
  onNavigate,
}: {
  pods: PodItem[] | null
  capacity: number | null
  onNavigate?: (target: DetailTarget) => void
}) {
  // null = the pod list couldn't be fetched (distinct from an empty node).
  const count = pods?.length ?? 0
  const pct = pods && capacity && capacity > 0 ? (count / capacity) * 100 : null
  const pctTone =
    pct == null ? '' : pct >= 90 ? 'bg-error' : pct >= 75 ? 'bg-warning' : 'bg-success'

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-[14px] font-semibold text-main">Scheduled Pods</h3>
        {pods && (
          <span className="text-[12px] text-tertiary tabular-nums">
            {count}
            {capacity != null ? ` / ${String(capacity)}` : ''}
            {pct != null ? ` · ${String(Math.round(pct))}%` : ''}
          </span>
        )}
        {pct != null && (
          <div className="flex-1 max-w-[240px] h-1.5 rounded-full bg-zGray-800 overflow-hidden">
            <div
              className={clsx('h-full', pctTone)}
              style={{ width: `${String(Math.min(100, pct))}%` }}
            />
          </div>
        )}
      </div>
      {pods === null ? (
        <div className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-6 text-center text-[12px] text-tertiary">
          Unavailable
        </div>
      ) : (
        <Table<PodItem>
          rows={pods}
          rowKey={(r) => `${r.namespace}/${r.name}`}
          defaultSort={{ key: 'name', dir: 'asc' }}
          empty="No pods scheduled on this node."
          onPrimaryAction={
            onNavigate
              ? (p) => onNavigate({ kind: 'Pod', namespace: p.namespace, name: p.name })
              : undefined
          }
          columns={NODE_POD_COLUMNS}
        />
      )}
    </div>
  )
}
