import { z } from 'zod'

import { stripTrailingSlashes } from '@/lib/agent/text-scan'

export const urlContextSchema = z.object({
  currentUrl: z.string().describe('The current URL the user is on'),
  pageType: z
    .enum([
      'home',
      'teams',
      'team',
      'agent',
      'agent-memories',
      'plans',
      'settings',
      'observability',
      'repository',
      'aws-account',
      'gcp-project',
      'cloudflare-account',
      'cloudflare-zone',
      'linode-account',
      'hetzner-account',
      'betterstack-integration',
      'tailscale-client',
      'zeabur-provider',
      'cluster',
      'aws-ecs-cluster',
      'other',
    ])
    .describe('The type of page the user is currently on'),
  teamId: z.string().optional(),
  provider: z
    .enum(['aws', 'gcp', 'linode', 'hetzner', 'cloudflare', 'betterstack', 'tailscale', 'zeabur'])
    .optional(),
  parentKind: z
    .enum(['aws-account', 'gcp-project', 'linode-account', 'hetzner-account'])
    .optional(),
  parentId: z.string().optional(),
  awsAccountId: z.string().optional(),
  gcpProjectId: z.string().optional(),
  cloudflareAccountId: z.string().optional(),
  cloudflareZoneId: z.string().optional(),
  linodeAccountId: z.string().optional(),
  hetznerAccountId: z.string().optional(),
  betterStackIntegrationId: z.string().optional(),
  tailscaleClientId: z.string().optional(),
  zeaburProviderId: z.string().optional(),
  installationId: z.string().optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  grafanaInstanceId: z.string().optional(),
  clusterId: z.string().optional(),
  clusterName: z.string().optional(),
  region: z.string().optional(),
  namespace: z.string().optional(),
  view: z.string().optional(),
  resourceKind: z.string().optional(),
  resourceId: z.string().optional(),
  bucket: z.string().optional(),
})

export type UrlContext = z.infer<typeof urlContextSchema>

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function compactPath(url: string): string {
  return stripTrailingSlashes(url.replace(/^\/[a-z]{2}(-[A-Z]{2})?(\/|$)/, '/') || '/') || '/'
}

export function pathSegments(url: string): string[] {
  return compactPath(url)
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeSegment(segment) ?? segment)
}

export function joinView(parts: string[]): string | undefined {
  return parts.length ? parts.join('/') : undefined
}

export function baseContext(
  currentUrl: string,
  searchParams?: URLSearchParams,
): Pick<UrlContext, 'currentUrl' | 'namespace' | 'view'> {
  return {
    currentUrl,
    namespace: searchParams?.get('namespace') ?? undefined,
    view: searchParams?.get('view') ?? undefined,
  }
}

export function resourceFromPath(rest: string[]): Pick<UrlContext, 'resourceKind' | 'resourceId'> {
  const resourceIndex = rest.indexOf('resources')

  if (resourceIndex < 0) return {}

  return {
    resourceKind: rest[resourceIndex + 1],
    resourceId: rest[resourceIndex + 2],
  }
}
