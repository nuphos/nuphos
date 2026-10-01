import { CONNECTOR_COLLECTIONS } from './conversation-denial'

const ROUTES: { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/aws-accounts\/[^/]+\/credentials$/u },
  {
    method: 'GET',
    path: /^\/aws-accounts\/[^/]+\/clusters\/[^/]+\/(?:kubeconfig|exec-credential)$/u,
  },
  { method: 'GET', path: /^\/gcp-projects\/[^/]+\/credentials$/u },
  {
    method: 'GET',
    path: /^\/gcp-projects\/[^/]+\/clusters\/[^/]+\/(?:kubeconfig|exec-credential)$/u,
  },
  {
    method: 'GET',
    path: /^\/(?:cloudflare|linode|hetzner)-accounts\/[^/]+\/credentials$/u,
  },
  {
    method: 'GET',
    path: /^\/(?:tencent|aliyun|volcengine|azure|huawei)-accounts\/[^/]+\/credentials$/u,
  },
  {
    method: 'GET',
    path: /^\/(?:betterstack-integrations|linear-workspaces|jira-sites|asana-accounts|resend-integrations|sentry-accounts|posthog-integrations)\/[^/]+\/credentials$/u,
  },
  {
    method: '*',
    path: /^\/uptime-kuma-instances\/[^/]+\/monitors(?:\/[^/]+)?(?:\/pause|\/resume)?$/u,
  },
  { method: 'GET', path: /^\/tailscale-clients\/[^/]+\/credentials$/u },
  { method: 'POST', path: /^\/tailscale-clients\/[^/]+\/tailnet-sessions$/u },
  {
    method: 'GET',
    path: /^\/zeabur-providers\/[^/]+\/(?:credentials|projects|servers)$/u,
  },
]

const CONNECTOR_DEEP_READ_COLLECTIONS = new Set([
  'github-installations',
  'gitlab-bindings',
  'sonarqube-integrations',
])
const CONNECTOR_DEEP_READ_PATHS = [
  /^notion-integrations\/[^/]+\/credentials$/u,
  /^upstash-accounts\/[^/]+\/(?:credentials|databases)$/u,
  /^vanta-integrations\/[^/]+\/tests$/u,
  /^secureframe-integrations\/[^/]+\/tests$/u,
]

// Domain resources use their canonical team REST handlers. Unlike the
// selected-credential routes above, these requests must continue through the
// normal team router so validation, role checks, serialization, and auditing
// stay identical for Desktop and conversation callers.
const CANONICAL_ROUTES: { method: string; path: RegExp }[] = [
  { method: '*', path: /^\/(?:cost-)?dashboards(?:\/|$)/u },
  { method: '*', path: /^\/architecture-diagrams(?:\/|$)/u },
  { method: '*', path: /^\/agent-triggers(?:\/|$)/u },
  { method: '*', path: /^\/knowledge(?:\/|$)/u },
  { method: '*', path: /^\/instructions(?:\/|$)/u },
  { method: 'GET', path: /^\/database-connections\/?$/u },
  {
    method: 'GET',
    path: /^\/database-connections\/[^/]+(?:\/catalog(?:\/collections|\/collection)?)?$/u,
  },
  {
    method: 'POST',
    path: /^\/database-connections\/[^/]+\/query\/mongodb$/u,
  },
]

// Connector discovery and read/proxy surfaces stay on their canonical
// handlers so they retain the same team-role, member allow-list, audit, and
// response behavior as Desktop. Raw credential paths that participate in a
// conversation's credential selection are dispatched through ROUTES first
// below, before this broader GET capability is considered.
function conversationConnectorApiPathAllowed(method: string, path: string): boolean {
  // Grafana is the one connector whose native skill performs both reads and
  // writes through Nuphos's server-side proxy. Binding management remains
  // denied; only the already-bound instance's proxy subtree is exposed.
  if (/^\/grafana-instances\/[^/]+\/proxy\//u.test(path)) return true
  if (method !== 'GET') return false
  if (/^\/connectors\/?$/u.test(path)) return true
  const match = /^\/([^/]+)(?:\/(.*))?$/u.exec(path)
  const collection = match?.[1]
  const rest = match?.[2]

  if (collection === undefined || !CONNECTOR_COLLECTIONS.has(collection)) return false
  // Every connector can be listed and its non-secret binding metadata read.
  if (!rest?.includes('/')) return true
  // These native skills use Nuphos as their API/token proxy. Other connector
  // skills receive selected credentials through ROUTES and call the provider
  // directly, so their deeper canonical subtrees stay denied.
  if (CONNECTOR_DEEP_READ_COLLECTIONS.has(collection)) return true
  const connectorPath = `${collection}/${rest}`

  return CONNECTOR_DEEP_READ_PATHS.some((pattern) => pattern.test(connectorPath))
}

export function conversationTeamApiPathAllowed(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase()

  return ROUTES.some(
    (route) => (route.method === '*' || route.method === normalizedMethod) && route.path.test(path),
  )
}

export function conversationCanonicalTeamApiPathAllowed(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase()

  return (
    conversationConnectorApiPathAllowed(normalizedMethod, path) ||
    CANONICAL_ROUTES.some(
      (route) =>
        (route.method === '*' || route.method === normalizedMethod) && route.path.test(path),
    )
  )
}

export function conversationTeamApiRoute(
  method: string,
  path: string,
): 'session' | 'canonical' | null {
  if (conversationTeamApiPathAllowed(method, path)) return 'session'
  if (conversationCanonicalTeamApiPathAllowed(method, path)) return 'canonical'

  return null
}

const PANEL_READS = [/^\/(?:billing\/)?usage$/u, /^\/(?:cost-)?dashboards(?:\/|$)/u]

/**
 * A dashboard panel script only reads: its selected credentials (enforced by the
 * session handlers), connector metadata, and the billing and dashboard data a
 * panel summarizes.
 */
export function dashboardPanelTeamApiRoute(
  method: string,
  path: string,
): 'session' | 'canonical' | null {
  if (method.toUpperCase() !== 'GET') return null
  if (conversationTeamApiPathAllowed('GET', path)) return 'session'
  if (conversationConnectorApiPathAllowed('GET', path)) return 'canonical'

  return PANEL_READS.some((pattern) => pattern.test(path)) ? 'canonical' : null
}
