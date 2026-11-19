import { CONNECTOR_INFO_LABELS } from '../../../lib/app-routes/types.ts'
import { connectorParentRef, isConnectorsPage } from '../../../lib/connectorScopeCrumb.ts'

import { MAIN_PAGE_BUCKET_KEY } from './workspaceState.ts'

import type { TabBucket, WorkspaceState } from './workspaceState'
import type { ConnectorDetailRef, ConnectorInfoProvider } from '../../../lib/app-routes/types.ts'
import type { ConnectorParentKind } from '../../../lib/connectorScopeCrumb.ts'
import type { Scope } from '../../../types'
import type { WorkspaceTabState } from '../../workspaceTabState'

/** The Connectors dialog over whatever the pane shows: the list, or one
 *  connector's detail. Runtime-only, like the dock's open state. */
export type ConnectorsDialogState = {
  detail: ConnectorDetailRef | null
  addIntegrationOpen: boolean
}

export function connectorsDialogFor(
  detail: ConnectorDetailRef | null = null,
  addIntegrationOpen = false,
): ConnectorsDialogState {
  return { detail, addIntegrationOpen }
}

/** The dialog a navigation to Connectors asks for: a link, or a tab update. */
export function connectorsDialogOf(navigation: {
  connectorDetail?: ConnectorDetailRef | null
  addIntegrationOpen?: boolean
}): ConnectorsDialogState {
  return connectorsDialogFor(navigation.connectorDetail, navigation.addIntegrationOpen)
}

/** The connector-info provider behind each parent kind. Databases are left
 *  out: their detail is per engine, and the scope does not name the engine. */
const PARENT_INFO_PROVIDERS: Partial<Record<ConnectorParentKind, ConnectorInfoProvider>> = {
  'onprem-cluster': 'onprem-k8s',
  'aws-account': 'aws',
  'gcp-project': 'gcp',
  'azure-subscription': 'azure',
  'cloudflare-account': 'cloudflare',
  'linode-account': 'linode',
  'hetzner-account': 'hetzner',
  'tencent-account': 'tencent',
  'aliyun-account': 'aliyun',
  'volcengine-account': 'volcengine',
  'betterstack-integration': 'betterstack',
  'uptime-kuma-instance': 'uptime-kuma',
  'tailscale-client': 'tailscale',
  'zeabur-provider': 'zeabur',
}

/** The Connectors detail for the connector a resource scope hangs off, or
 *  null when there is none to name (the Connectors list then opens). */
export function connectorDetailForScope(scope: Scope): ConnectorDetailRef | null {
  const parent = connectorParentRef(scope)
  const provider = parent ? PARENT_INFO_PROVIDERS[parent.kind] : undefined

  if (!parent || !provider) return null

  return { provider, connectorId: parent.id, name: CONNECTOR_INFO_LABELS[provider] }
}

function isConnectorsTab(tab: WorkspaceTabState): boolean {
  return isConnectorsPage(tab.scope, tab.active)
}

/** A bucket's tabs with every new arrival on Connectors put back as it was
 *  (or dropped, when the tab is new), and the arrival the dialog opens for. */
function revertConnectorsTabs(
  bucket: TabBucket,
  before: TabBucket | undefined,
): { tabs: WorkspaceTabState[]; diverted: WorkspaceTabState | null } {
  const tabs: WorkspaceTabState[] = []
  let diverted: WorkspaceTabState | null = null

  for (const tab of bucket.tabs) {
    const kept = before?.tabs.find((item) => item.id === tab.id)

    if (!isConnectorsTab(tab) || tab === kept) {
      tabs.push(tab)
      continue
    }
    if (kept && !isConnectorsTab(kept)) tabs.push(kept)
    if (!diverted || tab.id === bucket.activeTabId) diverted = tab
  }

  return { tabs, diverted }
}

/**
 * Connectors is a dialog, not a page. Any action that lands a tab on it — a
 * breadcrumb, a page's "Add a connector" link, Back into an old entry — is put
 * back as it was (a new tab is dropped, a main page opened for it closes
 * again) and opens the dialog instead, on the connector the tab named.
 */
export function divertConnectorsPage(prev: WorkspaceState, next: WorkspaceState): WorkspaceState {
  // A bucket left with no tab goes back to how it was, or away if it is new.
  const settled: Record<string, TabBucket | undefined> = {}
  let diverted: WorkspaceTabState | null = null

  for (const [key, bucket] of Object.entries(next.buckets)) {
    if (bucket === prev.buckets[key] || !bucket.tabs.some(isConnectorsTab)) continue
    const before = prev.buckets[key] as TabBucket | undefined
    const { tabs, diverted: arrival } = revertConnectorsTabs(bucket, before)

    if (!arrival) continue
    diverted = arrival
    const activeTabId = tabs.some((tab) => tab.id === bucket.activeTabId)
      ? bucket.activeTabId
      : (before?.activeTabId ?? null)

    settled[key] =
      tabs.length === 0
        ? before
        : { ...bucket, tabs, activeTabId, dockOpen: before?.dockOpen ?? false }
  }
  if (!diverted) return next
  const buckets = Object.fromEntries(
    Object.entries({ ...next.buckets, ...settled }).filter(
      (entry): entry is [string, TabBucket] => entry[1] !== undefined,
    ),
  )

  return {
    ...next,
    buckets,
    mainPageOpen: MAIN_PAGE_BUCKET_KEY in settled ? prev.mainPageOpen : next.mainPageOpen,
    connectorsDialog: connectorsDialogOf(diverted),
  }
}
