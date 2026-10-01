import { Metrics } from '@kubernetes/client-node'
import * as k8s from '@kubernetes/client-node'

import { contextRefreshers, parseCredentialExpiry } from './context-refreshers'
import {
  METRICS_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  K8sTimeoutError,
  is401,
  isPreRequestConnError,
  translateK8sError,
} from './errors'

// Multi-context state.
//
// There is no global "current context" — every k8s operation in this module
// takes a `context: string` and routes through `getClients(context)`. That
// keeps Nuphos tabs viewing different clusters truly independent: pointing
// Tab A at cluster X and Tab B at cluster Y produces two separate KubeConfig
// instances + API clients with no shared mutable state.
export type ClusterClients = {
  kc: k8s.KubeConfig
  coreApi: k8s.CoreV1Api
  appsApi: k8s.AppsV1Api
  batchApi: k8s.BatchV1Api
  networkingApi: k8s.NetworkingV1Api
  discoveryApi: k8s.DiscoveryV1Api
  storageApi: k8s.StorageV1Api
  rbacApi: k8s.RbacAuthorizationV1Api
  apiextensionsApi: k8s.ApiextensionsV1Api
  customObjectsApi: k8s.CustomObjectsApi
  metricsClient: MetricsClient
  /** Epoch ms at which the loaded credential stops working; null when unknown or static. */
  credentialExpiresAt: number | null
}
export const clientCache = new Map<string, ClusterClients>()

// In-flight credential refresh deduplication. Two concurrent 401s for the
// same context would otherwise call the refresher twice — and a refresher
// that vends single-use tokens (or rotates credentials per call) would
// invalidate one of the two retries. Coalesce into a single Promise.
const refreshInFlight = new Map<string, Promise<boolean>>()

export function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new K8sTimeoutError(timeoutMs)), timeoutMs)
  })

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

// The generated clients hand the RequestContext's signal straight to node-fetch,
// so attaching one here bounds (and actually aborts) every generated API call
// without touching the hundreds of call sites.
class DeadlineHttpLibrary implements k8s.HttpLibrary {
  private readonly inner = new k8s.IsomorphicFetchHttpLibrary()

  send(request: k8s.RequestContext) {
    if (!request.getSignal()) request.setSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))

    return this.inner.send(request)
  }
}

// Metrics calls node-fetch directly instead of going through the generated
// clients, so the HttpLibrary above can't reach it — bound it by racing. The
// socket is left to the OS rather than aborted, which is acceptable only
// because this path is optional and low-volume.
type MetricsClient = Pick<Metrics, 'getNodeMetrics' | 'getPodMetrics'>

function deadlineMetrics(kc: k8s.KubeConfig): MetricsClient {
  const inner = new Metrics(kc)

  return {
    getNodeMetrics: () => withDeadline(inner.getNodeMetrics(), METRICS_TIMEOUT_MS),
    getPodMetrics: (namespace?: string) =>
      withDeadline(inner.getPodMetrics(namespace), METRICS_TIMEOUT_MS),
  }
}

// Mirrors `kc.makeApiClient`, which offers no hook for a custom HttpLibrary.
export function buildApiClients(
  kc: k8s.KubeConfig,
): Omit<ClusterClients, 'kc' | 'credentialExpiresAt'> {
  const cluster = kc.getCurrentCluster()

  if (!cluster) throw new Error('KubeConfig has no active cluster')
  const config = k8s.createConfiguration({
    baseServer: new k8s.ServerConfiguration(cluster.server, {}),
    authMethods: { default: kc },
    httpApi: new DeadlineHttpLibrary(),
  })

  return {
    coreApi: new k8s.CoreV1Api(config),
    appsApi: new k8s.AppsV1Api(config),
    batchApi: new k8s.BatchV1Api(config),
    networkingApi: new k8s.NetworkingV1Api(config),
    discoveryApi: new k8s.DiscoveryV1Api(config),
    storageApi: new k8s.StorageV1Api(config),
    rbacApi: new k8s.RbacAuthorizationV1Api(config),
    apiextensionsApi: new k8s.ApiextensionsV1Api(config),
    customObjectsApi: new k8s.CustomObjectsApi(config),
    metricsClient: deadlineMetrics(kc),
  }
}

export function rebuildApiClients(entry: ClusterClients) {
  Object.assign(entry, buildApiClients(entry.kc))
}

/**
 * Re-fetch the context's credential through its registered refresher. Resolves
 * false (never rejects) when there is nothing to refresh or the refresh failed.
 */
export async function refreshContextCredentials(context: string): Promise<boolean> {
  // Coalesce concurrent refreshes for the same context so a single-use
  // credential isn't burned twice.
  const inflight = refreshInFlight.get(context)

  if (inflight) return inflight
  const promise = (async (): Promise<boolean> => {
    const refresher = contextRefreshers.get(context)

    if (!refresher) return false
    const fresh = await refresher()
    const entry = clientCache.get(context)

    if (!entry) return false
    // Mutate the existing kc in place. Watch informers and active port-
    // forwards hold references to this KubeConfig instance; replacing it
    // would orphan them on the stale credential. The API clients are
    // recreated so the new cluster/user fields propagate.
    entry.kc.loadFromString(fresh.yaml)
    entry.kc.setCurrentContext(context)
    entry.credentialExpiresAt = parseCredentialExpiry(fresh.expiresAt)
    rebuildApiClients(entry)

    return true
  })().catch((e: unknown) => {
    console.warn(`[k8s] credential refresh failed for "${context}":`, e)

    return false
  })

  refreshInFlight.set(context, promise)
  try {
    return await promise
  } finally {
    refreshInFlight.delete(context)
  }
}

export function credentialExpiresAt(context: string): number | null {
  return clientCache.get(context)?.credentialExpiresAt ?? null
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const MAX_CONN_RETRIES = 2

// Retry pre-request transport failures with a short linear backoff. Each retry
// re-runs `fn`; the underlying k8s client (node-fetch v2) allocates a new
// https.Agent per request (keepAlive=false), so each retry opens a fresh
// TCP/TLS connection even though getClients() returns the same cached entry.
async function withConnRetry<T>(context: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= MAX_CONN_RETRIES || !isPreRequestConnError(err)) throw err
      const delay = 150 * (attempt + 1)

      console.warn(
        `[k8s] connection error for "${context}" (attempt ${String(attempt + 1)}/${String(MAX_CONN_RETRIES + 1)}), retrying in ${String(delay)}ms:`,
        err,
      )
      await sleep(delay)
    }
  }
}

export async function withAuthRetry<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await authRetry(context, fn)
  } catch (err) {
    throw translateK8sError(err)
  }
}

async function authRetry<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withConnRetry(context, fn)
  } catch (err) {
    if (!is401(err)) throw err
    if (!(await refreshContextCredentials(context))) throw err
    console.log(`[k8s] 401 retry after credential refresh for "${context}"`)

    return await withConnRetry(context, fn)
  }
}

export async function init() {
  // No-op. Default kubeconfig contexts are discovered lazily by `listContexts`
  // and resolved on first use via `getClients`. Nuphos-loaded contexts come in
  // through `loadKubeconfigYaml`.
}

export function loadDefaultKubeconfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig()

  kc.loadFromDefault()

  return kc
}

function buildClients(context: string): ClusterClients {
  // For contexts that come from the on-disk default kubeconfig — re-read it
  // fresh so we capture user edits since process start. Nuphos-loaded contexts
  // are registered up front by `loadKubeconfigYaml` so they never hit this
  // path (an entry already exists in `clientCache`).
  const kc = loadDefaultKubeconfig()
  const exists = kc.getContexts().some((c) => c.name === context)

  if (!exists) {
    throw new Error(`Kubeconfig context "${context}" is not loaded`)
  }
  kc.setCurrentContext(context)

  return { kc, credentialExpiresAt: null, ...buildApiClients(kc) }
}

export function getClients(context: string): ClusterClients {
  let cached = clientCache.get(context)

  if (!cached) {
    cached = buildClients(context)
    clientCache.set(context, cached)
  }

  return cached
}

// --- Exposed to k8s-watch / k8s-metrics so they don't have to duplicate auth + client wiring.
export function getKubeConfig(context: string): k8s.KubeConfig {
  return getClients(context).kc
}

export function getCoreApi(context: string): k8s.CoreV1Api {
  return getClients(context).coreApi
}

export function getAppsApi(context: string): k8s.AppsV1Api {
  return getClients(context).appsApi
}

export function getBatchApi(context: string): k8s.BatchV1Api {
  return getClients(context).batchApi
}

export function getNetworkingApi(context: string): k8s.NetworkingV1Api {
  return getClients(context).networkingApi
}

export function getDiscoveryApi(context: string): k8s.DiscoveryV1Api {
  return getClients(context).discoveryApi
}

export function getStorageApi(context: string): k8s.StorageV1Api {
  return getClients(context).storageApi
}

export function getMetricsClient(context: string): MetricsClient {
  return getClients(context).metricsClient
}
