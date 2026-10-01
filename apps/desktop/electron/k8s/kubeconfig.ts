import * as k8s from '@kubernetes/client-node'

import {
  buildApiClients,
  clientCache,
  loadDefaultKubeconfig,
  rebuildApiClients,
  getClients,
  withAuthRetry,
} from './client'
import { contextRefreshers, parseCredentialExpiry } from './context-refreshers'

import type { RefreshedCredential } from './context-refreshers'

export function listContexts() {
  // Union of (a) contexts declared in the on-disk kubeconfig and (b) contexts
  // registered at runtime via loadKubeconfigYaml (Nuphos-fetched ephemeral
  // clusters). The deduplicated result is what the renderer presents in the
  // cluster picker.
  const defaultKc = loadDefaultKubeconfig()
  const out: {
    name: string
    cluster: string
    user: string
    namespace: string | null
    current: boolean
  }[] = []
  const seen = new Set<string>()

  for (const c of defaultKc.getContexts()) {
    seen.add(c.name)
    out.push({
      name: c.name,
      cluster: c.cluster,
      user: c.user,
      namespace: c.namespace ?? null,
      current: false,
    })
  }
  for (const [name, entry] of clientCache) {
    if (seen.has(name)) continue
    const ctx = entry.kc.getContextObject(name)

    out.push({
      name,
      cluster: ctx?.cluster ?? '',
      user: ctx?.user ?? '',
      namespace: ctx?.namespace ?? null,
      current: false,
    })
  }

  return out
}

/**
 * Register a kubeconfig YAML into the per-context cache and return its context
 * name. Nuphos's cluster IPC handlers call this after fetching short-lived
 * credentials. If the context is already loaded the YAML is merged in place
 * (KubeConfig identity preserved) so live informers and port-forwards keep
 * working under refreshed credentials.
 */
export async function loadKubeconfigYaml(
  yamlText: string,
  label: string,
  onRefresh?: () => Promise<RefreshedCredential>,
  expiresAt?: string | null,
): Promise<string> {
  const tmpKc = new k8s.KubeConfig()

  tmpKc.loadFromString(yamlText)
  // Resolve to a context name that actually exists in the YAML: prefer the
  // current-context field, fall back to the sole context if there is only
  // one. Falling back to `label` (an arbitrary diagnostic string) would
  // leave subsequent `getClients(label)` calls trying to setCurrentContext()
  // to a name that isn't in the kubeconfig — silently mis-routing requests.
  let contextName = tmpKc.getCurrentContext()

  if (!contextName) {
    const contexts = tmpKc.getContexts()

    if (contexts.length === 1) {
      contextName = contexts[0].name
    } else {
      throw new Error(
        `loadKubeconfigYaml ("${label}"): kubeconfig has no current-context and ` +
          `${String(contexts.length)} contexts; cannot pick one unambiguously`,
      )
    }
  }
  if (onRefresh) {
    contextRefreshers.set(contextName, onRefresh)
  } else {
    // A context can be reloaded under the same name with a different auth
    // model. Do not leave a stale cloud-style 401 refresher attached to a
    // fixed credential (notably an on-prem ServiceAccount token).
    contextRefreshers.delete(contextName)
  }
  const existing = clientCache.get(contextName)
  const credentialExpiresAt = parseCredentialExpiry(expiresAt)

  if (existing) {
    existing.kc.loadFromString(yamlText)
    existing.kc.setCurrentContext(contextName)
    existing.credentialExpiresAt = credentialExpiresAt
    rebuildApiClients(existing)
  } else {
    const kc = new k8s.KubeConfig()

    kc.loadFromString(yamlText)
    kc.setCurrentContext(contextName)
    clientCache.set(contextName, { kc, credentialExpiresAt, ...buildApiClients(kc) })
  }

  return contextName
}

export type ClusterAccessProbe = { ok: boolean; errors: string[] }

/**
 * Cheapest possible "can this identity see anything?" check, across three
 * scopes (cluster-scoped, node, namespaced) so a partially-granted identity
 * isn't mistaken for a denied one.
 *
 * `limit: 1` is load-bearing, not an optimisation. The full lists are unbounded:
 * a cluster with one namespace per environment can return tens of megabytes,
 * which takes minutes and reads as a hang — the gate that calls this blocks
 * every cluster page. We only care about the status code, never the items.
 */
export async function probeClusterAccess(context: string): Promise<ClusterAccessProbe> {
  const probes: (() => Promise<unknown>)[] = [
    () => getClients(context).coreApi.listNamespace({ limit: 1 }),
    () => getClients(context).coreApi.listNode({ limit: 1 }),
    () => getClients(context).coreApi.listNamespacedPod({ namespace: 'default', limit: 1 }),
  ]
  const results = await Promise.allSettled(probes.map((p) => withAuthRetry(context, p)))
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason?.message ?? r.reason))

  return { ok: errors.length < results.length, errors }
}
