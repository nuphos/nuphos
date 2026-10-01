export type MetricsUpdate = {
  rowKey: string
  cpu: number | null
  memory: number | null
  // Set for Node + Workload rows — sum of pod requests scheduled on the
  // node / matched by the workload selector. The pod metrics path leaves
  // these undefined so the watch patcher ignores them for Pod rows.
  cpu_request?: number | null
  memory_request?: number | null
  pods?: number | null
  // Set only for Workload rows (Deployment / StatefulSet) — sum of pod
  // limits when every matched pod declares one. Pods inherit limits via
  // the standard `change` channel from the pod spec.
  cpu_limit?: number | null
  memory_limit?: number | null
}

export type Subscriber = {
  scopeKey: string
  context: string
  namespace: string | null
  onUpdates: (updates: MetricsUpdate[]) => void
}

export const POLL_MS = 10_000

export function usageKey(context: string, rowKey: string): string {
  return `${context}\x1f${rowKey}`
}

export function shapeUsage(cpu: number, memory: number): { cpu: number; memory: number } {
  return {
    cpu: Math.round(cpu),
    memory: Math.round(memory / (1024 * 1024)) * 1024 * 1024,
  }
}
