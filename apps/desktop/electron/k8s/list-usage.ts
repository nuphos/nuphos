import { getClients, withAuthRetry } from './client'
import { parseCpu, parseMemory } from './utils'

export type ContainerUsageRow = {
  namespace: string
  pod: string
  container: string
  node: string | null
  // CPU in millicores, memory in bytes. `*_pct` is usage/limit*100, null when
  // that dimension has no limit (a "% of limit" figure is undefined then).
  cpu_usage: number | null
  cpu_limit: number | null
  cpu_pct: number | null
  memory_usage: number | null
  memory_limit: number | null
  memory_pct: number | null
}

// Sorted by the higher of the two ratios, the payload is capped so a large
// cluster (hundreds of pods) can't ship an unbounded list every poll. The
// frontend threshold dropdown filters this set client-side.
const ABNORMAL_USAGE_CAP = 200
// Drop containers well under any selectable threshold before shipping — bounds
// payload on big clusters. MUST stay <= the frontend's lowest dropdown option
// (currently 70%); the margin leaves room to add a lower option later.
const ABNORMAL_USAGE_MIN_PCT = 50

function maxUsagePct(r: ContainerUsageRow): number {
  return Math.max(r.cpu_pct ?? 0, r.memory_pct ?? 0)
}

// One-shot per-container usage-vs-limit snapshot for the Overview
// "High / Abnormal Resource Usage" table. Joins metrics-server per-container
// usage against each container's spec limits. Containers without any limit are
// skipped — there's nothing to rate them against.
export function listContainerUsage(context: string): Promise<ContainerUsageRow[]> {
  return withAuthRetry(context, async () => {
    const { coreApi, metricsClient: metrics } = getClients(context)
    // Don't swallow the metrics error: this view is *about* usage, so any
    // failure should reject. That lets withAuthRetry refresh+retry a 401, keeps
    // real errors intact (rather than relabeling them "metrics-server
    // unavailable"), and surfaces as a rejected promise → the Overview panel
    // renders "Unavailable" (metrics-server absent throws 404/503 here).
    const [podsRes, metricsRes] = await Promise.all([
      coreApi.listPodForAllNamespaces(),
      metrics.getPodMetrics(),
    ])

    type Limits = { cpuLimit: number | null; memLimit: number | null; node: string | null }
    const limitsByKey = new Map<string, Limits>()

    for (const p of podsRes.items) {
      const ns = p.metadata?.namespace ?? ''
      const pod = p.metadata?.name ?? ''
      const node = p.spec?.nodeName ?? null

      for (const c of p.spec?.containers ?? []) {
        const lim = c.resources?.limits

        limitsByKey.set(`${ns}/${pod}/${c.name}`, {
          cpuLimit: lim?.cpu ? parseCpu(lim.cpu) : null,
          memLimit: lim?.memory ? parseMemory(lim.memory) : null,
          node,
        })
      }
    }

    const rows: ContainerUsageRow[] = []

    for (const m of metricsRes.items) {
      const ns = m.metadata?.namespace ?? ''
      const pod = m.metadata?.name ?? ''

      for (const c of m.containers ?? []) {
        const limits = limitsByKey.get(`${ns}/${pod}/${c.name}`)

        if (!limits) continue
        const { cpuLimit, memLimit, node } = limits
        const hasCpu = cpuLimit != null && cpuLimit > 0
        const hasMem = memLimit != null && memLimit > 0

        if (!hasCpu && !hasMem) continue
        const cpuUsage = parseCpu(c.usage?.cpu ?? '0')
        const memUsage = parseMemory(c.usage?.memory ?? '0')

        rows.push({
          namespace: ns,
          pod,
          container: c.name ?? '',
          node,
          cpu_usage: cpuUsage,
          cpu_limit: hasCpu ? cpuLimit : null,
          cpu_pct: hasCpu ? (cpuUsage / cpuLimit) * 100 : null,
          memory_usage: memUsage,
          memory_limit: hasMem ? memLimit : null,
          memory_pct: hasMem ? (memUsage / memLimit) * 100 : null,
        })
      }
    }
    const ranked = rows
      .filter((r) => maxUsagePct(r) >= ABNORMAL_USAGE_MIN_PCT)
      .sort((a, b) => maxUsagePct(b) - maxUsagePct(a))

    if (ranked.length > ABNORMAL_USAGE_CAP) {
      console.warn(
        `[overview] container usage list truncated to ${String(ABNORMAL_USAGE_CAP)} of ${String(ranked.length)} rows`,
      )

      return ranked.slice(0, ABNORMAL_USAGE_CAP)
    }

    return ranked
  })
}
