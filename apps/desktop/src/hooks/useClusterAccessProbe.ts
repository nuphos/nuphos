import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import { classifyProbe } from '../lib/clusterAccessError'

// Distinguishes a cluster endpoint that cannot be reached from a probe whose
// broad list calls are forbidden. A forbidden broad probe cannot prove the
// identity has no access: it may still have permissions in selected namespaces.

export type ClusterAccessState =
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'denied'; subject: string | null }
  | { state: 'unreachable' }

// Probe results are cached per kubeconfig context so switching tabs or pages
// doesn't re-fire the probe; "Re-check" clears the entry.
const probeCache = new Map<string, ClusterAccessState>()

// The probe gates every cluster page, so it must always terminate. The main
// process already bounds each request, but that deadline is sized for slow list
// calls on big clusters; waiting it out here would mean staring at "Checking
// cluster access…" with no explanation. Give up sooner and say why.
const PROBE_DEADLINE_MS = 12_000

/**
 * Probe in-cluster access for a resolved kubeconfig context. Three cheap list
 * calls across different scopes (namespaces, nodes, pods). Forbidden results
 * keep normal views available so each page can report its precise RBAC error.
 */
export function useClusterAccessProbe(
  context: string | null,
): ClusterAccessState & { retry: () => void } {
  const [nonce, setNonce] = useState(0)
  const resolveState = (ctx: string | null): ClusterAccessState =>
    ctx ? (probeCache.get(ctx) ?? { state: 'checking' }) : { state: 'ok' }
  const [state, setState] = useState<ClusterAccessState>(() => resolveState(context))
  // Switching context (or asking for a re-check) re-resolves during render, so
  // the previous cluster's verdict never shows through while the probe re-runs.
  const [probedFor, setProbedFor] = useState({ context, nonce })

  if (probedFor.context !== context || probedFor.nonce !== nonce) {
    setProbedFor({ context, nonce })
    setState(resolveState(context))
  }

  useEffect(() => {
    if (!context) return
    if (probeCache.get(context)) return
    let alive = true
    // The watchdog's verdict is terminal for this attempt. A late result must
    // not land afterwards: `classifyProbe` falls back to 'ok' for a mixed error
    // set, so a slow ambiguous answer would replace an accurate "unreachable"
    // with empty, working-looking views. The mask offers Retry (which also
    // re-issues the credential), so recovery stays explicit rather than a
    // surprise flip several seconds later.
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // Not cached: the next mount (or a re-check) should probe again rather
      // than inherit a verdict that was never actually reached.
      if (alive) setState({ state: 'unreachable' })
    }, PROBE_DEADLINE_MS)

    void (async () => {
      // One IPC round trip; the main process issues the three `limit: 1` list
      // calls. Never list in full here — see `probeClusterAccess`.
      const { ok, errors } = await api
        .probeClusterAccess(context)
        .catch((e: unknown) => ({ ok: false, errors: [String(e)] }))

      clearTimeout(timer)
      if (timedOut) return
      const next = classifyProbe(ok, errors)

      if (next.state !== 'unreachable') probeCache.set(context, next)
      if (alive) setState(next)
    })()

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [context, nonce])

  const retry = useCallback(() => {
    if (context) probeCache.delete(context)
    setNonce((n) => n + 1)
  }, [context])

  return { ...state, retry }
}
