export const CONNECTOR_COLLECTIONS = new Set([
  'aws-accounts',
  'gcp-projects',
  'tencent-accounts',
  'aliyun-accounts',
  'volcengine-accounts',
  'huawei-accounts',
  'azure-accounts',
  'cloudflare-accounts',
  'linode-accounts',
  'hetzner-accounts',
  'onprem-clusters',
  'betterstack-integrations',
  'uptime-kuma-instances',
  'linear-workspaces',
  'jira-sites',
  'asana-accounts',
  'sentry-accounts',
  'tailscale-clients',
  'zeabur-providers',
  'vanta-integrations',
  'secureframe-integrations',
  'resend-integrations',
  'posthog-integrations',
  'github-installations',
  'gitlab-bindings',
  'grafana-instances',
  'sonarqube-integrations',
  'notion-integrations',
  'upstash-accounts',
  'slack-installations',
  'lark-installations',
])

const DOMAIN_COLLECTIONS = new Set([
  'connectors',
  'dashboards',
  'cost-dashboards',
  'architecture-diagrams',
  'agent-triggers',
  'knowledge',
  'instructions',
  'database-connections',
])
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const METHODS = new Set(['GET', 'HEAD', 'OPTIONS', ...MUTATIONS])

const BOUNDARY =
  "This is a fixed capability boundary of agent conversations, not the signed-in user's role or permissions: no role, token, or retry opens it, and it is not something to ask for access to."

/**
 * The denial lands in the model's context, so nothing from the request is
 * echoed: a path the caller chose could read as an instruction. Only a
 * recognized collection name — ours, not theirs — describes the operation.
 */
function knownCollection(suffix: string): string | null {
  const collection = /^\/([^/]+)/u.exec(suffix)?.[1]

  if (collection === undefined) return null

  return CONNECTOR_COLLECTIONS.has(collection) || DOMAIN_COLLECTIONS.has(collection)
    ? collection
    : null
}

/** Read by the model, so it says what the denial means and what to do next. */
export function conversationDenialMessage(method: string, suffix: string | null): string {
  const normalizedMethod = method.toUpperCase()
  const collection = suffix ? knownCollection(suffix) : null
  const shownMethod = METHODS.has(normalizedMethod) ? normalizedMethod : null
  const operation =
    collection && shownMethod
      ? `${shownMethod} on /${collection}`
      : 'the requested team API operation'
  const opening = `Agent conversations may call only an allow-listed part of the Nuphos team API, and ${operation} is not in it.`

  if (collection === null || !CONNECTOR_COLLECTIONS.has(collection)) {
    return `${opening} ${BOUNDARY} Do the work through a capability the conversation already has, or tell the user which step to take in the Nuphos app.`
  }
  if (MUTATIONS.has(normalizedMethod)) {
    return `${opening} ${BOUNDARY} Creating, editing, or removing a ${collection} binding is deliberately reserved for a person: ask the user to do it in the Nuphos app under Settings -> Integrations, and say exactly which values they need to enter.`
  }

  return `${opening} ${BOUNDARY} The binding itself may well be fine, so do not send the user off to rebind it: reach this data through the connector's own skill and the credentials selected for this conversation.`
}
