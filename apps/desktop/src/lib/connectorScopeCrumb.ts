import type { Scope } from '../types'

/**
 * The connector binding a drill-down page hangs off — the "which account /
 * project / subscription" breadcrumb segment between `Connectors` and the page.
 *
 * This union is the hinge of the Connectors trail: a scope kind that resolves
 * to one of these gets that segment, and a kind that resolves to `null`
 * deliberately has none. It used to be an inline `||` chain of `scope.kind ===`
 * checks in the breadcrumb, which is why `azure-subscription` could be treated
 * as connector navigation everywhere else yet silently render no segment.
 */
export type ConnectorParentKind =
  | 'onprem-cluster'
  | 'aws-account'
  | 'gcp-project'
  | 'azure-subscription'
  | 'cloudflare-account'
  | 'linode-account'
  | 'hetzner-account'
  | 'tencent-account'
  | 'aliyun-account'
  | 'volcengine-account'
  | 'betterstack-integration'
  | 'uptime-kuma-instance'
  | 'database-connection'
  | 'tailscale-client'
  | 'zeabur-provider'

export type ConnectorParentRef = { kind: ConnectorParentKind; id: string }

/** CloudLogo provider slugs used by connector crumbs. Structurally checked
 *  against `CloudLogo`'s prop at every call site, so a typo fails to compile. */
export type ConnectorParentLogo =
  | 'onprem-k8s'
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'cloudflare'
  | 'linode'
  | 'hetzner'
  | 'tencent'
  | 'aliyun'
  | 'volcengine'
  | 'betterstack'
  | 'uptime-kuma'
  | 'tailscale'
  | 'zeabur'

export type ConnectorParentMeta = {
  /** Vendor mark for the crumb and its picker rows. Null when the binding has
   *  no single vendor — databases render their engine glyph instead. */
  logo: ConnectorParentLogo | null
  /** Shown while the connector inventory is still loading, or when the binding
   *  is gone (revoked, or another team's). */
  fallbackLabel: string
  /** Section heading in the crumb's sibling picker. */
  group: string
}

/**
 * Every parent kind's presentation. A `Record` on purpose: adding a member to
 * `ConnectorParentKind` without filling this in is a compile error, not a
 * connector that quietly renders a shorter trail than its neighbours.
 */
export const CONNECTOR_PARENT_META: Record<ConnectorParentKind, ConnectorParentMeta> = {
  'onprem-cluster': {
    logo: 'onprem-k8s',
    fallbackLabel: 'Kubernetes',
    group: 'Kubernetes',
  },
  'aws-account': { logo: 'aws', fallbackLabel: 'AWS account', group: 'AWS Accounts' },
  'gcp-project': { logo: 'gcp', fallbackLabel: 'GCP project', group: 'GCP Projects' },
  'azure-subscription': {
    logo: 'azure',
    fallbackLabel: 'Azure subscription',
    group: 'Azure Subscriptions',
  },
  'cloudflare-account': {
    logo: 'cloudflare',
    fallbackLabel: 'Cloudflare account',
    group: 'Cloudflare Accounts',
  },
  'linode-account': { logo: 'linode', fallbackLabel: 'Linode account', group: 'Linode Accounts' },
  'hetzner-account': { logo: 'hetzner', fallbackLabel: 'Hetzner Cloud', group: 'Hetzner Cloud' },
  'betterstack-integration': {
    logo: 'betterstack',
    fallbackLabel: 'Better Stack',
    group: 'Better Stack',
  },
  'database-connection': { logo: null, fallbackLabel: 'Database', group: 'Databases' },
  'uptime-kuma-instance': {
    logo: 'uptime-kuma',
    fallbackLabel: 'Uptime Kuma',
    group: 'Uptime Kuma',
  },
  'tailscale-client': { logo: 'tailscale', fallbackLabel: 'Tailscale', group: 'Tailscale' },
  'zeabur-provider': { logo: 'zeabur', fallbackLabel: 'Zeabur', group: 'Zeabur' },
  'tencent-account': { logo: 'tencent', fallbackLabel: 'Tencent Cloud', group: 'Tencent Cloud' },
  'aliyun-account': { logo: 'aliyun', fallbackLabel: 'Alibaba Cloud', group: 'Alibaba Cloud' },
  'volcengine-account': { logo: 'volcengine', fallbackLabel: 'Volcengine', group: 'Volcengine' },
}

/** Declaration order of `CONNECTOR_PARENT_META` — also the order the crumb's
 *  sibling picker lists its groups in. */

export const CONNECTOR_PARENT_KINDS = Object.keys(CONNECTOR_PARENT_META) as ConnectorParentKind[]

/**
 * The connector a scope drills into, or null for scopes that sit outside the
 * Connectors trail. The `never` default makes a newly added `Scope` kind a
 * compile error here — the check the old `||` chain could not perform.
 */
export function connectorParentRef(scope: Scope): ConnectorParentRef | null {
  switch (scope.kind) {
    case 'aws-account':
      return { kind: 'aws-account', id: scope.accountId }
    case 'gcp-project':
      return { kind: 'gcp-project', id: scope.projectId }
    case 'azure-subscription':
      return { kind: 'azure-subscription', id: scope.subscriptionId }
    case 'cloudflare-account':
      return { kind: 'cloudflare-account', id: scope.accountId }
    case 'linode-account':
      return { kind: 'linode-account', id: scope.accountId }
    case 'hetzner-account':
      return { kind: 'hetzner-account', id: scope.accountId }
    case 'tencent-account':
      return { kind: 'tencent-account', id: scope.accountId }
    case 'aliyun-account':
      return { kind: 'aliyun-account', id: scope.accountId }
    case 'volcengine-account':
      return { kind: 'volcengine-account', id: scope.accountId }
    case 'betterstack-integration':
      return { kind: 'betterstack-integration', id: scope.integrationId }
    case 'uptime-kuma-instance':
      return { kind: 'uptime-kuma-instance', id: scope.instanceId }
    case 'database-connection':
      return { kind: 'database-connection', id: scope.connectionId }
    case 'tailscale-client':
      return { kind: 'tailscale-client', id: scope.clientId }
    case 'zeabur-provider':
      return { kind: 'zeabur-provider', id: scope.zeaburId }
    // Resources nested a level deeper still name their connector.
    case 'cluster':
      return scope.parentKind === 'onprem-cluster'
        ? { kind: 'onprem-cluster', id: scope.onpremClusterId }
        : { kind: scope.parentKind, id: scope.parentId }
    case 'aws-ecs-cluster':
      return { kind: 'aws-account', id: scope.accountId }
    case 'cloudflare-zone':
      return { kind: 'cloudflare-account', id: scope.accountId }
    // The team root is above the trail; compliance integrations (Vanta,
    // Secureframe) drill down through the generic connector-info card, which
    // carries its own leaf crumb.
    case 'team':
    case 'compliance-integration':
      return null
    default: {
      const unhandled: never = scope

      return unhandled
    }
  }
}

const PARENT_SCOPES: Record<ConnectorParentKind, (teamId: string, id: string) => Scope> = {
  // An on-prem connector is the cluster itself. This lightweight inverse is
  // used by generic connector bookkeeping and tests; interactive navigation
  // goes through `enterCluster` so its kubeconfig is installed first.
  'onprem-cluster': (teamId, id) => ({
    kind: 'cluster',
    teamId,
    parentKind: 'onprem-cluster',
    parentId: id,
    clusterName: id,
    provider: 'onprem',
    region: 'onprem',
    onpremClusterId: id,
  }),
  'aws-account': (teamId, id) => ({ kind: 'aws-account', teamId, accountId: id }),
  'gcp-project': (teamId, id) => ({ kind: 'gcp-project', teamId, projectId: id }),
  'azure-subscription': (teamId, id) => ({
    kind: 'azure-subscription',
    teamId,
    subscriptionId: id,
  }),
  'cloudflare-account': (teamId, id) => ({ kind: 'cloudflare-account', teamId, accountId: id }),
  'linode-account': (teamId, id) => ({ kind: 'linode-account', teamId, accountId: id }),
  'hetzner-account': (teamId, id) => ({ kind: 'hetzner-account', teamId, accountId: id }),
  'tencent-account': (teamId, id) => ({ kind: 'tencent-account', teamId, accountId: id }),
  'aliyun-account': (teamId, id) => ({ kind: 'aliyun-account', teamId, accountId: id }),
  'volcengine-account': (teamId, id) => ({ kind: 'volcengine-account', teamId, accountId: id }),
  'betterstack-integration': (teamId, id) => ({
    kind: 'betterstack-integration',
    teamId,
    integrationId: id,
  }),
  'uptime-kuma-instance': (teamId, id) => ({
    kind: 'uptime-kuma-instance',
    teamId,
    instanceId: id,
  }),
  'database-connection': (teamId, id) => ({
    kind: 'database-connection',
    teamId,
    connectionId: id,
  }),
  'tailscale-client': (teamId, id) => ({ kind: 'tailscale-client', teamId, clientId: id }),
  'zeabur-provider': (teamId, id) => ({ kind: 'zeabur-provider', teamId, zeaburId: id }),
}

/** The scope the crumb's sibling picker jumps to. Inverse of
 *  `connectorParentRef`; the two are held together by a round-trip test. */
export function connectorParentScope(ref: ConnectorParentRef, teamId: string): Scope {
  return PARENT_SCOPES[ref.kind](teamId, ref.id)
}

type DirectConnectorParentKind = Exclude<ConnectorParentKind, 'onprem-cluster'>

function isConnectorParentKind(kind: Scope['kind']): kind is DirectConnectorParentKind {
  return kind in CONNECTOR_PARENT_META
}

export function isTeamIntegrationsActive(active: string): boolean {
  return active === 'team.integrations' || active === 'team.accounts'
}

/**
 * Pages reached from the Connectors page rather than the resource sidebar —
 * "who may use this binding" settings. Their trail deliberately ends at the
 * connector crumb, so they must have one: typing the table on
 * `ConnectorParentKind` is what makes that a compile-time guarantee.
 */
export const CONNECTOR_SETTINGS_PAGES: Record<ConnectorParentKind, readonly string[]> = {
  'onprem-cluster': [],
  'aws-account': ['aws.roles', 'aws.role'],
  'gcp-project': ['gcp.service-accounts', 'gcp.service-account', 'gcp.iam'],
  'azure-subscription': ['azure.apps'],
  'cloudflare-account': ['cloudflare.iam'],
  // `database.settings` (plan policy, removal) has no counterpart among the
  // others and keeps its ordinary page crumb.
  'database-connection': ['database.access'],
  'linode-account': [],
  'hetzner-account': [],
  'tencent-account': [],
  'aliyun-account': [],
  'volcengine-account': [],
  'betterstack-integration': [],
  'uptime-kuma-instance': [],
  'tailscale-client': [],
  'zeabur-provider': [],
}

export function isSettingsNavigation(scope: Scope, active: string): boolean {
  return isConnectorParentKind(scope.kind) && CONNECTOR_SETTINGS_PAGES[scope.kind].includes(active)
}

export function isIntegrationNavigation(scope: Scope, active: string): boolean {
  if (scope.kind === 'team') return isTeamIntegrationsActive(active)
  if (scope.kind === 'uptime-kuma-instance') return true

  return isSettingsNavigation(scope, active)
}
