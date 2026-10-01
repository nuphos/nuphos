import { baseContext, joinView, resourceFromPath } from './url-context-shared'

import type { UrlContext } from './url-context-shared'

function parseClusterContext(
  currentUrl: string,
  searchParams: URLSearchParams | undefined,
  teamId: string,
  provider: 'aws' | 'gcp' | 'linode',
  parentId: string,
  rest: string[],
): UrlContext | null {
  if (rest[0] !== 'clusters' || !rest[1] || !rest[2]) return null
  const region = rest[1]
  const clusterName = rest[2]
  const pageParts = rest.slice(3)
  const parentKind =
    provider === 'aws' ? 'aws-account' : provider === 'gcp' ? 'gcp-project' : 'linode-account'

  return {
    ...baseContext(currentUrl, searchParams),
    pageType: 'cluster',
    teamId,
    provider,
    parentKind,
    parentId,
    awsAccountId: provider === 'aws' ? parentId : undefined,
    gcpProjectId: provider === 'gcp' ? parentId : undefined,
    linodeAccountId: provider === 'linode' ? parentId : undefined,
    clusterName,
    region,
    view: joinView(pageParts) ?? 'overview',
    ...resourceFromPath(pageParts),
  }
}

export function parseInfraContext(
  currentUrl: string,
  searchParams: URLSearchParams | undefined,
  teamId: string,
  rest: string[],
): UrlContext | null {
  const provider = rest[1]
  const parentId = rest[2]
  const inner = rest.slice(3)

  if (!provider || !parentId) return null

  if (provider === 'aws') {
    const cluster = parseClusterContext(currentUrl, searchParams, teamId, 'aws', parentId, inner)

    if (cluster) return cluster
    if (inner[0] === 'ecs-clusters' && inner[1] && inner[2]) {
      return {
        ...baseContext(currentUrl, searchParams),
        pageType: 'aws-ecs-cluster',
        teamId,
        provider: 'aws',
        awsAccountId: parentId,
        parentKind: 'aws-account',
        parentId,
        region: inner[1],
        clusterName: inner[2],
        view: joinView(inner.slice(3)) ?? 'services',
      }
    }

    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'aws-account',
      teamId,
      provider: 'aws',
      awsAccountId: parentId,
      parentId,
      parentKind: 'aws-account',
      view: joinView(inner) ?? 'overview',
      resourceKind: inner[0],
      resourceId: inner[1],
      region: inner[0] === 'cloudformation' || inner[0] === 'lightsail' ? inner[1] : undefined,
      bucket: inner[0] === 's3-buckets' ? inner[1] : undefined,
    }
  }

  if (provider === 'gcp') {
    const cluster = parseClusterContext(currentUrl, searchParams, teamId, 'gcp', parentId, inner)

    if (cluster) return cluster

    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'gcp-project',
      teamId,
      provider: 'gcp',
      gcpProjectId: parentId,
      parentId,
      parentKind: 'gcp-project',
      view: joinView(inner) ?? 'overview',
      resourceKind: inner[0],
      resourceId: inner[1],
    }
  }

  if (provider === 'linode') {
    const cluster = parseClusterContext(currentUrl, searchParams, teamId, 'linode', parentId, inner)

    if (cluster) return cluster

    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'linode-account',
      teamId,
      provider: 'linode',
      linodeAccountId: parentId,
      parentId,
      parentKind: 'linode-account',
      view: joinView(inner) ?? 'instances',
      resourceKind: inner[0],
      resourceId: inner[1],
    }
  }

  if (provider === 'hetzner') {
    // Hetzner Cloud has no managed Kubernetes offering, so there is no cluster
    // context to parse — the account page lists servers only.
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'hetzner-account',
      teamId,
      provider: 'hetzner',
      hetznerAccountId: parentId,
      parentId,
      parentKind: 'hetzner-account',
      view: joinView(inner) ?? 'servers',
      resourceKind: inner[0],
      resourceId: inner[1],
    }
  }

  if (provider === 'cloudflare') {
    const zoneId = inner[0] === 'zones' ? inner[1] : undefined

    return {
      ...baseContext(currentUrl, searchParams),
      pageType: zoneId ? 'cloudflare-zone' : 'cloudflare-account',
      teamId,
      provider: 'cloudflare',
      cloudflareAccountId: parentId,
      cloudflareZoneId: zoneId,
      parentId,
      view: joinView(inner) ?? 'zones',
      resourceKind: zoneId ? inner[2] : inner[0],
      resourceId: zoneId ? inner[3] : inner[1],
    }
  }

  if (provider === 'betterstack') {
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'betterstack-integration',
      teamId,
      provider: 'betterstack',
      betterStackIntegrationId: parentId,
      parentId,
      view: joinView(inner) ?? 'monitors',
    }
  }

  if (provider === 'tailscale') {
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'tailscale-client',
      teamId,
      provider: 'tailscale',
      tailscaleClientId: parentId,
      parentId,
      view: joinView(inner) ?? 'devices',
    }
  }

  if (provider === 'zeabur') {
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'zeabur-provider',
      teamId,
      provider: 'zeabur',
      zeaburProviderId: parentId,
      parentId,
      view: joinView(inner) ?? 'projects',
    }
  }

  return null
}
