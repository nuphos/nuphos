// The one place connectors are filed into categories. Two surfaces read it —
// the Add connector catalog and the sidebar's bound-instance groups — so the
// two can't drift into calling the same thing "Infra" and "Cloud
// infrastructure". Category order here is the order both surfaces render.
//
// Runtime-import nothing: type-only imports keep this module loadable under
// plain `node --test` (no JSX, no React).

export type ConnectorCategoryId =
  | 'infrastructure'
  | 'observability'
  | 'databases'
  | 'networking'
  | 'compliance'
  | 'source-control'
  | 'project-management'
  | 'document'
  | 'email'
  | 'messaging'

export type ConnectorCategory = {
  id: ConnectorCategoryId
  label: string
  /** Providers offered in the Add connector catalog, in the order shown there. */
  catalog: string[]
  /**
   * Providers that can be bound and reach the sidebar but are never offered in
   * the catalog as a choice of their own: sub-products of another connector
   * (`gcp-monitoring`) and engines bound through a shared wizard
   * (`postgresql`).
   */
  sidebarOnly?: string[]
  /**
   * Starts folded in the sidebar so the nav stays compact; expanding lasts only
   * until the next team switch. Every category that can reach the sidebar sets
   * it — Databases was the lone holdout until #574, and only because it
   * predated the hand-written list this now replaces.
   */
  foldedAtRest?: boolean
}

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    foldedAtRest: true,
    catalog: [
      'aws',
      'gcp',
      'cloudflare',
      'linode',
      'hetzner',
      'tencent',
      'aliyun',
      'volcengine',
      'huawei',
      'azure',
      'zeabur',
      'onprem-k8s',
    ],
  },
  {
    id: 'observability',
    label: 'Observability',
    foldedAtRest: true,
    catalog: ['betterstack', 'uptime-kuma', 'grafana', 'sentry', 'posthog'],
    sidebarOnly: ['gcp-monitoring'],
  },
  {
    id: 'databases',
    label: 'Databases',
    foldedAtRest: true,
    catalog: ['mongodb', 'upstash'],
    sidebarOnly: ['postgresql'],
  },
  {
    id: 'networking',
    label: 'Networking',
    foldedAtRest: true,
    catalog: ['tailscale'],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    foldedAtRest: true,
    catalog: ['vanta', 'secureframe', 'sonarqube'],
  },
  {
    id: 'source-control',
    label: 'Source control',
    foldedAtRest: true,
    catalog: ['github', 'gitlab'],
  },
  {
    id: 'project-management',
    label: 'Project management',
    catalog: ['linear', 'jira', 'asana'],
  },
  {
    id: 'document',
    label: 'Document',
    catalog: ['notion'],
  },
  {
    id: 'email',
    label: 'Email',
    catalog: ['resend'],
  },
  {
    id: 'messaging',
    label: 'Messaging',
    catalog: ['slack', 'discord', 'lark'],
  },
]

/**
 * Providers whose connection satisfies onboarding step 1 ("Connect your cloud
 * assets").
 *
 * Deliberately NOT the Infrastructure category: Tailscale counts as connected
 * cloud for onboarding but is filed under Networking in the catalog. Keep this
 * an explicit list — reading it off a category would silently change what the
 * first-run checklist accepts the next time a provider is re-filed.
 */
const CLOUD_ONBOARDING_PROVIDERS = new Set([
  'aws',
  'gcp',
  'azure',
  'cloudflare',
  'linode',
  'hetzner',
  'tencent',
  'aliyun',
  'volcengine',
  'huawei',
  'tailscale',
  'zeabur',
])

/** The provider in a sidebar item key (`integration:<provider>:<id>`). */
export function providerFromIntegrationKey(key: string): string | null {
  const match = /^integration:([^:]+):/.exec(key)

  return match ? match[1] : null
}

export function satisfiesCloudOnboarding(integrationKey: string): boolean {
  const provider = providerFromIntegrationKey(integrationKey)

  return !!provider && CLOUD_ONBOARDING_PROVIDERS.has(provider)
}

/** Same question as `satisfiesCloudOnboarding`, asked of a provider name
 *  directly — for callers holding an AccountSet rather than sidebar item keys.
 *  Both read the one list above, so "has this team connected a cloud?" cannot
 *  drift between the sidebar and the agent page. */
export function isCloudOnboardingProvider(provider: string): boolean {
  return CLOUD_ONBOARDING_PROVIDERS.has(provider)
}

/** Same question again, asked of the whole account set. Kept beside the
 * provider list so the Agent home, its toolbar CTA, and the sidebar checklist
 * cannot invent three definitions of "first run". */
export function hasCloudOnboardingBinding(accounts: object): boolean {
  return Object.entries(accounts).some(
    ([provider, bindings]) =>
      isCloudOnboardingProvider(provider) && Array.isArray(bindings) && bindings.length > 0,
  )
}

const CATEGORY_BY_PROVIDER = new Map<string, ConnectorCategory>(
  CONNECTOR_CATEGORIES.flatMap((category) =>
    [...category.catalog, ...(category.sidebarOnly ?? [])].map(
      (provider) => [provider, category] as const,
    ),
  ),
)

export function connectorCategoryFor(provider: string): ConnectorCategory | undefined {
  return CATEGORY_BY_PROVIDER.get(provider)
}

/**
 * Bound sidebar items grouped by category, in category order, skipping
 * categories nothing was bound in.
 *
 * Project management / Document / Messaging never produce a group here, but not
 * because they are filtered out: those connectors have no in-app pages to drill
 * into, so they never become sidebar items in the first place. The day one does,
 * it gets a group for free — which is the point of sharing this table.
 */
export function groupByConnectorCategory<T extends { key: string }>(
  items: T[],
): { category: ConnectorCategory; items: T[] }[] {
  return CONNECTOR_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) => {
      const provider = providerFromIntegrationKey(item.key)

      return !!provider && connectorCategoryFor(provider)?.id === category.id
    }),
  })).filter((group) => group.items.length > 0)
}
