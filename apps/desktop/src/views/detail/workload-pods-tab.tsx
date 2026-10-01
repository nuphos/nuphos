import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { PodsView } from '../PodsView'
import { useResetOnKey } from '../useResetOnKey'

import type { DetailTarget } from './target'
import type { PodItem, PodLabelSelector } from '../../types'

// Matched-pods tab: reuses the real PodsView so the workload detail gets
// the same UsageBar columns, live watch, context menu, etc. — for free.
// The selector is resolved once on mount and turned into a client-side
// `filterPod` callback; the live pod stream then naturally adds/removes
// rows as pods come and go.
export function WorkloadPodsTab({
  kind,
  namespace,
  name,
  onNavigate,
}: {
  kind: string
  namespace: string
  name: string
  onNavigate?: (target: DetailTarget) => void
}) {
  const context = useRequiredKubeContext()
  const [selector, setSelector] = useState<PodLabelSelector | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(`${context}\0${kind}\0${namespace}\0${name}`, () => {
    setSelector(undefined)
    setError(null)
  })
  useEffect(() => {
    let cancelled = false

    api
      .getWorkloadSelector(context, kind, namespace, name)
      .then((sel) => !cancelled && setSelector(sel))
      .catch((e: unknown) => !cancelled && setError(String(e)))

    return () => {
      cancelled = true
    }
  }, [context, kind, namespace, name])

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (selector === undefined) {
    return <div className="p-6 text-tertiary text-[13px]">Loading…</div>
  }
  if (selector === null) {
    return <div className="p-6 text-tertiary text-[13px]">Workload has no selector.</div>
  }

  const filterPod = (p: PodItem) => podLabelsMatchSelector(p.labels, selector)

  return (
    <PodsView
      namespace={namespace}
      filter=""
      refreshKey={0}
      onSelect={(p) => onNavigate?.({ kind: 'Pod', namespace: p.namespace, name: p.name })}
      onSelectNode={(name) => onNavigate?.({ kind: 'Node', namespace: null, name })}
      onCount={noop}
      filterPod={filterPod}
      // Distinct storage key keeps the workload-scoped column widths from
      // overwriting the main Pods view's preferences.
      storageKey={`pods:workload:${kind}`}
    />
  )
}

const noop = () => {}

// Client-side label-selector match — mirrors the backend's
// `podMatchesSelector` so the workload's Pods tab can filter the live pod
// stream without hitting the API for each delta.
function podLabelsMatchSelector(
  labels: Record<string, string>,
  selector: PodLabelSelector,
): boolean {
  for (const [k, v] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[k] !== v) return false
  }
  for (const expr of selector.matchExpressions ?? []) {
    const val = labels[expr.key]
    const values = expr.values ?? []

    // Match kube-apimachinery semantics: `In` needs the key to exist
    // AND the value to be in the set; `NotIn` is satisfied when the key
    // is absent OR (present and value not in the set).
    if (expr.operator === 'In' && (val == null || !values.includes(val))) return false
    if (expr.operator === 'NotIn' && val != null && values.includes(val)) return false
    if (expr.operator === 'Exists' && val == null) return false
    if (expr.operator === 'DoesNotExist' && val != null) return false
  }

  return true
}
