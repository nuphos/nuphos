import type { K8sWatchEvent } from '../api'

export function watchCacheKey(context: string, kind: string, namespace: string | null): string {
  return `watch:${context}|${kind}|${namespace ?? ''}`
}

export const FLASH_MS = 700

// Same column-level diff that usePolledList does — kept identical so the flash
// behavior is unchanged for migrated views.
export function diffFields<T>(prev: T, next: T): string[] {
  const out: string[] = []
  const a = prev as Record<string, unknown>
  const b = next as Record<string, unknown>

  for (const f of Object.keys(b)) {
    if (a[f] === b[f]) continue
    if (typeof a[f] === 'object' && typeof b[f] === 'object') {
      if (JSON.stringify(a[f]) === JSON.stringify(b[f])) continue
    }
    out.push(f)
  }

  return out
}

type MetricsUpdates = Extract<K8sWatchEvent, { type: 'metrics' }>['updates']

// Patch fields silently — no flash; metrics jitter would be noisy.
export function applyMetricsUpdates<T>(byKey: Map<string, T>, updates: MetricsUpdates): boolean {
  let mutated = false

  for (const u of updates) {
    const existing = byKey.get(u.rowKey) as
      | (T & {
          cpu?: number | null
          memory?: number | null
          cpu_request?: number | null
          memory_request?: number | null
          pods?: number | null
          cpu_limit?: number | null
          memory_limit?: number | null
        })
      | undefined

    if (!existing) continue
    existing.cpu = u.cpu
    existing.memory = u.memory
    // Each metrics path leaves the fields it doesn't compute as
    // undefined — guard so unrelated row types keep their existing
    // (spec-sourced) values.
    if (u.cpu_request !== undefined) existing.cpu_request = u.cpu_request
    if (u.memory_request !== undefined) existing.memory_request = u.memory_request
    if (u.pods !== undefined) existing.pods = u.pods
    if (u.cpu_limit !== undefined) existing.cpu_limit = u.cpu_limit
    if (u.memory_limit !== undefined) existing.memory_limit = u.memory_limit
    byKey.set(u.rowKey, { ...existing } as T)
    mutated = true
  }

  return mutated
}
