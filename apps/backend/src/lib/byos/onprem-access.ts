import { parseRelayedKubeconfig } from '@/lib/byos/agent-kubeconfig'
import { logError } from '@/lib/observability'

/**
 * What the credential a customer handed us can actually do, asked of their own
 * API server through the relay.
 *
 * This exists because the alternative is us telling them what we think we can
 * do. Kubernetes will answer the question itself — SelfSubjectReview says who
 * the token is, SelfSubjectRulesReview says what it may do — so the enrolment
 * screen can show a readout computed inside their cluster rather than a claim
 * from our side. It is also the fastest way to settle "why did the agent say it
 * could not do X".
 */
export type OnpremAccessReadout = {
  reachable: boolean
  /** Why not, in words an operator can act on. Only set when unreachable. */
  unreachableReason?: string
  serverVersion?: string
  identity?: { username: string; groups: string[] }
  /** Namespaces the credential can list, or the fact that it cannot. */
  namespaces?: { denied: true } | { denied: false; count: number; sample: string[] }
  permissions?: {
    /** Rules are evaluated in one namespace; cluster-wide grants show up here too. */
    namespace: string
    /** Human-readable lines: "get, list, watch on pods, services". */
    summary: string[]
    /**
     * True if anything beyond read verbs is granted. **null when Kubernetes said
     * the evaluation was incomplete** — a webhook authorizer or an RBAC
     * evaluation error can drop rules from the answer, and absent write rules
     * then prove nothing. Reporting that as "read-only" would be a reassuring
     * claim we cannot support, which is worse than saying we do not know.
     */
    canWrite: boolean | null
    /** Why the answer is partial, in Kubernetes' words. */
    incompleteReason?: string
  }
}

const READ_VERBS = new Set(['get', 'list', 'watch'])
const AUTHENTICATION_SELF_REVIEW_RESOURCES = new Set(['selfsubjectreviews'])
const AUTHORIZATION_SELF_REVIEWS = new Set(['selfsubjectaccessreviews', 'selfsubjectrulesreviews'])
const REQUEST_TIMEOUT_MS = 15_000
/** Rules are namespace-scoped; `default` exists in every cluster. */
const RULES_NAMESPACE = 'default'
const NAMESPACE_SAMPLE = 8

type ApiCall = (
  path: string,
  init?: { method?: string; body?: string },
) => Promise<{
  status: number
  json: unknown
}>

/**
 * Build a caller bound to one cluster: TLS pinned to the customer's CA, routed
 * through the relay proxy, authenticated with whatever their kubeconfig carries.
 * Their API server's TLS terminates at the API server — the proxy only tunnels.
 */
function apiCaller(opts: {
  endpoint: string
  caBase64: string
  user: Record<string, unknown>
  proxyUrl: string
}): ApiCall {
  const ca = Buffer.from(opts.caBase64, 'base64').toString('utf8')
  const token = typeof opts.user.token === 'string' ? opts.user.token : undefined
  const clientCert =
    typeof opts.user['client-certificate-data'] === 'string'
      ? Buffer.from(opts.user['client-certificate-data'], 'base64').toString('utf8')
      : undefined
  const clientKey =
    typeof opts.user['client-key-data'] === 'string'
      ? Buffer.from(opts.user['client-key-data'], 'base64').toString('utf8')
      : undefined

  return async (path, init) => {
    const response = await fetch(`${opts.endpoint.replace(/\/$/, '')}${path}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        Accept: 'application/json',
      },
      proxy: opts.proxyUrl,
      tls: { ca, ...(clientCert && clientKey ? { cert: clientCert, key: clientKey } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    } as RequestInit)
    const text = await response.text()
    let json: unknown

    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }

    return { status: response.status, json }
  }
}

/** Turn a SelfSubjectRulesReview into lines a human reads in one pass. */
type ResourceRule = {
  apiGroups?: string[]
  verbs?: string[]
  resources?: string[]
}

function isSelfReviewCreate(rule: ResourceRule): boolean {
  const apiGroups = (rule.apiGroups ?? []).filter(Boolean)
  const resources = (rule.resources ?? []).filter(Boolean)

  if (apiGroups.length !== 1 || !resources.length) return false
  if (apiGroups[0] === 'authentication.k8s.io') {
    return resources.every((resource) => AUTHENTICATION_SELF_REVIEW_RESOURCES.has(resource))
  }

  if (apiGroups[0] === 'authorization.k8s.io') {
    return resources.every((resource) => AUTHORIZATION_SELF_REVIEWS.has(resource))
  }

  return false
}

/** Self-review creation asks Kubernetes about this credential; it changes no cluster resource. */
function grantsWriteAccess(rule: ResourceRule, verbs: string[]): boolean {
  return verbs.some(
    (verb) =>
      verb === '*' || (!READ_VERBS.has(verb) && !(verb === 'create' && isSelfReviewCreate(rule))),
  )
}

export function summarizeRules(rules: ResourceRule[]): {
  summary: string[]
  canWrite: boolean
} {
  const byVerbs = new Map<string, Set<string>>()
  let canWrite = false

  for (const rule of rules) {
    const verbs = (rule.verbs ?? []).filter(Boolean).sort((a, b) => a.localeCompare(b))
    const resources = (rule.resources ?? []).filter(Boolean)

    if (!verbs.length || !resources.length) continue
    if (grantsWriteAccess(rule, verbs)) canWrite = true
    const key = verbs.join(', ')
    const bucket = byVerbs.get(key) ?? new Set<string>()

    for (const resource of resources) bucket.add(resource)
    byVerbs.set(key, bucket)
  }
  const summary = [...byVerbs.entries()]
    // Widest grants first: that is what someone scanning the list needs to see.
    .sort((a, b) => b[1].size - a[1].size)
    .map(([verbs, resources]) => {
      const named = [...resources].sort((a, b) => a.localeCompare(b)).join(', ')

      return `${verbs} on ${named}`
    })

  return { summary, canWrite }
}

function describeFailure(status: number): string {
  if (status === 401)
    return 'The API server rejected the credential (401). The token may have expired.'
  if (status === 403)
    return 'The credential reached the API server but is not allowed to read the version endpoint (403).'

  return `The API server answered ${String(status)}.`
}

/**
 * Ask the cluster about itself. Every step degrades on its own: an older API
 * server without SelfSubjectReview still yields a permission summary, and a
 * credential that cannot list namespaces still reports its identity.
 */
export async function readOnpremAccess(opts: {
  kubeconfig: string
  proxyUrl: string
  teamId: string
}): Promise<OnpremAccessReadout> {
  const parsed = parseRelayedKubeconfig(opts.kubeconfig)

  if (!parsed) {
    return {
      reachable: false,
      unreachableReason: 'The stored kubeconfig is no longer usable. Re-enrol the cluster.',
    }
  }
  const call = apiCaller({ ...parsed, proxyUrl: opts.proxyUrl })

  let version: { status: number; json: unknown }

  try {
    version = await call('/version')
  } catch (err) {
    logError('onprem.access.unreachable', err, { team_id: opts.teamId })

    return { reachable: false, unreachableReason: relayFailureReason(err) }
  }
  if (version.status !== 200) {
    return { reachable: false, unreachableReason: describeFailure(version.status) }
  }

  const readout: OnpremAccessReadout = {
    reachable: true,
    serverVersion: (version.json as { gitVersion?: string } | null)?.gitVersion,
  }

  const identity = await call('/apis/authentication.k8s.io/v1/selfsubjectreviews', {
    method: 'POST',
    body: JSON.stringify({ apiVersion: 'authentication.k8s.io/v1', kind: 'SelfSubjectReview' }),
  }).catch(() => null)
  const userInfo = (
    identity?.json as { status?: { userInfo?: { username?: string; groups?: string[] } } } | null
  )?.status?.userInfo

  if (userInfo?.username) {
    readout.identity = { username: userInfo.username, groups: userInfo.groups ?? [] }
  }

  const rulesReview = await call('/apis/authorization.k8s.io/v1/selfsubjectrulesreviews', {
    method: 'POST',
    body: JSON.stringify({
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SelfSubjectRulesReview',
      spec: { namespace: RULES_NAMESPACE },
    }),
  }).catch(() => null)
  const rulesStatus = (
    rulesReview?.json as {
      status?: {
        resourceRules?: ResourceRule[]
        incomplete?: boolean
        evaluationError?: string
      }
    } | null
  )?.status

  if (rulesStatus?.resourceRules) {
    const { summary, canWrite } = summarizeRules(rulesStatus.resourceRules)
    const partial = rulesStatus.incomplete === true || Boolean(rulesStatus.evaluationError)

    readout.permissions = {
      namespace: RULES_NAMESPACE,
      summary,
      // A partial answer can only ever prove a grant, never its absence.
      canWrite: partial && !canWrite ? null : canWrite,
      ...(partial
        ? {
            incompleteReason:
              rulesStatus.evaluationError ||
              'Kubernetes reported the rules evaluation as incomplete.',
          }
        : {}),
    }
  }

  const namespaces = await call('/api/v1/namespaces?limit=500').catch(() => null)

  if (namespaces?.status === 403) {
    readout.namespaces = { denied: true }
  } else if (namespaces?.status === 200) {
    const items =
      (namespaces.json as { items?: { metadata?: { name?: string } }[] } | null)?.items ?? []
    const names = items.flatMap((item) => (item.metadata?.name ? [item.metadata.name] : []))

    readout.namespaces = {
      denied: false,
      count: names.length,
      sample: names.slice(0, NAMESPACE_SAMPLE),
    }
  }

  return readout
}

/**
 * The relay's own refusals arrive as fetch failures here, so translate the ones
 * an operator can act on rather than surfacing "fetch failed".
 */
function relayFailureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)

  if (message.includes('503')) {
    return 'The relay agent in the cluster is not connected. Check the nuphos-relay-agent pods.'
  }
  if (message.includes('502')) {
    return 'The relay agent is connected but could not reach the API server address in the kubeconfig.'
  }
  if (/timed out|timeout|aborted/i.test(message)) {
    return 'The API server did not answer in time through the relay.'
  }

  return `Could not reach the API server through the relay: ${message}`
}
