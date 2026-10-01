// What `bun run dev --managed` decides without touching a cluster: which kube
// contexts count as local, the kubeconfig the backend is confined to, the env
// that turns the provisioner on, and how managed pods read on the dashboard.
import { homedir } from 'node:os'
import { join } from 'node:path'

export const MANAGED_NAMESPACE = 'openab-runtimes-local'
/** The only kubeconfig the backend's kubectl sees in managed mode; written after the guard passes. */
export const MANAGED_KUBECONFIG = join(homedir(), '.cache', 'nuphos-dev', 'managed-kubeconfig.json')

const LOCAL_CONTEXT = /^(orbstack|docker-desktop|minikube|kind-[\w.-]+)$/u
const LOCAL_SERVER_HOST =
  /^(127\.0\.0\.1|localhost|\[::1\]|[\w.-]+\.docker\.internal|[\w.-]+\.orb\.local)$/u

export function isLocalContextName(context: string): boolean {
  return LOCAL_CONTEXT.test(context)
}

export function isLocalServer(server: string): boolean {
  try {
    return LOCAL_SERVER_HOST.test(new URL(server).hostname)
  } catch {
    return false
  }
}

type Kubeconfig = {
  clusters?: { name?: string; cluster?: { server?: string } }[]
  contexts?: { name?: string; context?: { cluster?: string } }[]
  'current-context'?: string
  [key: string]: unknown
}

/** `kubectl config view --minify --flatten -o json` for one context, accepted only for a local cluster. */
export function localKubeconfig(
  context: string,
  json: string,
): { ok: true; kubeconfig: Kubeconfig } | { ok: false; reason: string } {
  if (!isLocalContextName(context))
    return { ok: false, reason: `"${context}" is not a local cluster context` }
  let parsed: Kubeconfig

  try {
    parsed = JSON.parse(json) as Kubeconfig
  } catch {
    return { ok: false, reason: `no kube context "${context}"` }
  }
  const entry = parsed.contexts?.find((c) => c.name === context)
  const server = parsed.clusters?.find((c) => c.name === entry?.context?.cluster)?.cluster?.server

  if (!entry || parsed.contexts?.length !== 1 || !server)
    return { ok: false, reason: `no kube context "${context}"` }
  if (!isLocalServer(server))
    return { ok: false, reason: `"${context}" points at ${server}, not this machine` }

  return { ok: true, kubeconfig: { ...parsed, 'current-context': context } }
}

/** Why OrbStack cannot host managed agents yet, from `orbctl status` and `orbctl config get k8s.enable`; null when it can. */
export function orbstackProblem(status: string | null, k8sEnabled: string | null): string | null {
  if (status === null) return 'OrbStack is not installed — brew install --cask orbstack'
  if (status.trim() !== 'Running') return 'OrbStack is not running — run: orbctl start'
  if (k8sEnabled?.trim() !== 'true') return 'OrbStack Kubernetes is off — run: orbctl start k8s'

  return null
}

export function managedBackendEnv(context: string): Record<string, string> {
  return {
    KUBECONFIG: MANAGED_KUBECONFIG,
    CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED: 'true',
    CLAUDE_CODE_RUNTIME_KUBECTL: 'true',
    CLAUDE_CODE_RUNTIME_KUBE_CONTEXT: context,
    CLAUDE_CODE_RUNTIME_NAMESPACE: MANAGED_NAMESPACE,
    // A laptop cluster has one node and no isolated runtime pool.
    CLAUDE_CODE_RUNTIME_NODE_SELECTOR: '',
    CLAUDE_CODE_RUNTIME_NODE_TOLERATIONS: '',
  }
}

type Pod = {
  metadata?: { labels?: Record<string, string> }
  status?: {
    phase?: string
    containerStatuses?: {
      ready?: boolean
      state?: { waiting?: { reason?: string }; terminated?: { reason?: string } }
    }[]
  }
}

function podState(pod: Pod): string {
  const container = pod.status?.containerStatuses?.[0]
  const reason = container?.state?.waiting?.reason ?? container?.state?.terminated?.reason

  if (reason) return reason
  if (container?.ready) return 'ready'

  return pod.status?.phase ?? 'Pending'
}

/** `kubectl get pods -o json` as dashboard health: one `<agent>: <state>` pair per pod. */
export function managedPodHealth(json: string): Record<string, string> {
  let items: Pod[]

  try {
    items = (JSON.parse(json) as { items?: Pod[] }).items ?? []
  } catch {
    return { pods: 'unreadable kubectl output' }
  }
  const agents = items.filter((pod) => pod.metadata?.labels?.app?.startsWith('openab-'))

  if (agents.length === 0)
    return { pods: 'none yet — Settings › Agents › Add agent › Nuphos Managed Cloud Agent' }

  return Object.fromEntries(
    agents.map((pod) => [
      (pod.metadata?.labels?.app ?? '').replace(/^openab-/u, '').slice(0, 14),
      podState(pod),
    ]),
  )
}
