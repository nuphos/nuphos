import { AppError } from '@/lib/errors'

export type ConnectorSelectionKey =
  | 'githubInstallationIds'
  | 'gitlabBindingIds'
  | 'grafanaInstanceIds'
  | 'sonarqubeIntegrationIds'
  | 'notionIntegrationIds'
  | 'upstashAccountIds'
  | 'cloudflareAccountIds'

const SELECTION_SCOPED_CONNECTORS = new Map<string, ConnectorSelectionKey>([
  ['github-installations', 'githubInstallationIds'],
  ['gitlab-bindings', 'gitlabBindingIds'],
  ['grafana-instances', 'grafanaInstanceIds'],
  ['sonarqube-integrations', 'sonarqubeIntegrationIds'],
  ['notion-integrations', 'notionIntegrationIds'],
  ['upstash-accounts', 'upstashAccountIds'],
  ['cloudflare-accounts', 'cloudflareAccountIds'],
])

export type ConnectorSelection = Partial<Record<ConnectorSelectionKey, string[]>>

export type ScopedConnectorBinding = {
  collection: string
  bindingId: string
  key: ConnectorSelectionKey
}

/** Null for the collection itself, so listing stays open to every conversation. */
export function selectionScopedConnectorBinding(path: string): ScopedConnectorBinding | null {
  const match = /^\/([^/]+)\/([^/]+)(?:\/|$)/u.exec(path)
  const collection = match?.[1]
  const bindingId = match?.[2]

  if (collection === undefined || bindingId === undefined) return null
  const key = SELECTION_SCOPED_CONNECTORS.get(collection)

  return key ? { collection, bindingId, key } : null
}

/**
 * An absent array means the conversation was created before this connector
 * carried a per-conversation selection, and keeps its team-wide reach. A
 * present array is authoritative, including when it is empty.
 */
export function connectorSelectionAllows(
  selection: ConnectorSelection,
  scoped: ScopedConnectorBinding,
): boolean {
  const ids = selection[scoped.key]

  return ids === undefined || ids.includes(scoped.bindingId)
}

export function assertConnectorSelectionAllowed(
  selection: ConnectorSelection,
  scoped: ScopedConnectorBinding,
): void {
  if (connectorSelectionAllows(selection, scoped)) return
  throw new AppError(
    403,
    'conversation_api_forbidden',
    `This ${scoped.collection} binding is not selected for the current conversation`,
  )
}
