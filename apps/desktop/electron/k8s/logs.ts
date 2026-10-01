import { parseTimestampedLine } from '../logParse'

import { getClients, withAuthRetry } from './client'
import { is403, isNoPreviousLog } from './errors'
import { podLogContainers } from './log-containers'
import { getWorkloadSelector } from './log-stream'
import { podMatchesSelector } from './rows-workloads'

import type { LogQuery, WorkloadLogLine } from './log-stream'

// One-shot pod logs, returned as structured lines (same shape as the workload
// stream's WorkloadLogLine) so the Logs UI can render/search/export uniformly.
// `timestamps: true` prefixes each line with an RFC3339 stamp that
// parseTimestampedLine splits off into `timestamp`; the renderer decides
// whether to show it (Off / UTC / Local).
export function getPodLogs(
  context: string,
  namespace: string,
  name: string,
  container: string | null,
  query: LogQuery = {},
): Promise<WorkloadLogLine[]> {
  const { tailLines, previous = false, sinceSeconds } = query

  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    let raw: string

    try {
      raw = await coreApi.readNamespacedPodLog({
        namespace,
        name,
        container: container ?? undefined,
        ...(tailLines != null ? { tailLines } : {}),
        timestamps: true,
        // `previous: true` reads the last terminated instance's logs (equivalent
        // to `kubectl logs --previous`) — for post-crash / CrashLoopBackOff triage.
        previous,
        // Time-window mode: only lines from the last `sinceSeconds` (omitted in
        // line-count mode); tailLines still bounds the result.
        ...(sinceSeconds != null ? { sinceSeconds } : {}),
      })
    } catch (e) {
      // "previous" on a container that never restarted is an expected empty
      // result — return no rows so the renderer can show a clean empty state
      // instead of regex-matching an error across the IPC boundary. Re-throw
      // anything else (real failure).
      if (previous && isNoPreviousLog(e)) return []
      throw e
    }
    // Keep blank physical lines (drop only the trailing newline's empty tail)
    // so multi-line output round-trips through the shared render/export path.
    const lines = raw.split('\n')

    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

    return lines.map((l) => parseTimestampedLine(l, name, container ?? ''))
  })
}

// One-shot "previous instance" logs for a whole workload — the snapshot
// counterpart to startWorkloadLogStream. Previous logs are a historical
// snapshot of each already-terminated container, so there's nothing to follow;
// we read `previous: true` for every matched (pod, container), skip the ones
// with no prior instance (or no access), and return the merged, time-sorted
// rows in the same WorkloadLogLine shape the live stream emits.
export function getWorkloadPreviousLogs(
  context: string,
  kind: string,
  namespace: string,
  name: string,
  query: LogQuery = {},
): Promise<WorkloadLogLine[]> {
  const { tailLines } = query

  return withAuthRetry(context, async () => {
    const selector = await getWorkloadSelector(context, kind, namespace, name)

    if (!selector) return []
    const { coreApi } = getClients(context)
    const podsRes = await coreApi.listNamespacedPod({ namespace })
    const matched = podsRes.items.filter((p) => podMatchesSelector(p, selector))
    // Flatten to one task per (pod, container), then read with bounded
    // parallelism so snapshot latency doesn't scale linearly with pods ×
    // containers on large workloads (push to `out` is safe — single-threaded).
    const targets: { podName: string; container: string }[] = []

    for (const pod of matched) {
      const podName = pod.metadata?.name ?? ''

      for (const c of podLogContainers(pod)) {
        targets.push({ podName, container: c.name })
      }
    }
    const out: WorkloadLogLine[] = []
    const CONCURRENCY = 16

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      await Promise.all(
        targets.slice(i, i + CONCURRENCY).map(async ({ podName, container }) => {
          let raw: string

          try {
            raw = await coreApi.readNamespacedPodLog({
              namespace,
              name: podName,
              container,
              ...(tailLines != null ? { tailLines } : {}),
              timestamps: true,
              previous: true,
            })
          } catch (e) {
            // Skip only the expected misses — no previous instance, or no access
            // to this one container (like the live stream tolerates RBAC). Real
            // failures (auth / network / API) re-throw so withAuthRetry can retry
            // a 401 and the renderer surfaces the error instead of a false empty
            // state. (Matches getPodLogs' single-container handling.)
            if (isNoPreviousLog(e) || is403(e)) return
            throw e
          }
          const lines = raw.split('\n')

          if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
          for (const l of lines) out.push(parseTimestampedLine(l, podName, container))
        }),
      )
    }
    // Merge across pods by timestamp (null timestamps keep their relative order).
    out.sort((a, b) => {
      const at = a.timestamp ?? ''
      const bt = b.timestamp ?? ''

      return at < bt ? -1 : at > bt ? 1 : 0
    })

    return out
  })
}
