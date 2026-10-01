import type { MentionTarget } from './types.ts'
import type { KubernetesClusterProvider } from '../kubernetesClusterRoutes'

export function parseInfraLink(
  teamId: string,
  rest: string[],
  trailingSlash: boolean,
  url: URL,
): MentionTarget | null {
  if (rest[0] === 'infra' && rest[1] && rest[2]) {
    const provider = rest[1]
    const parentId = rest[2]
    const inner = rest.slice(3)

    if (provider === 'aws') {
      if (inner.length === 0) {
        return { type: 'aws-account', teamId, accountId: parentId }
      }
      if (inner[0] === 'vpcs' && inner[1]) {
        return {
          type: 'aws-vpc',
          teamId,
          accountId: parentId,
          vpcId: inner[1],
        }
      }
      if (inner[0] === 'network-acls' && inner[1]) {
        return {
          type: 'aws-nacl',
          teamId,
          accountId: parentId,
          naclId: inner[1],
        }
      }
      if (inner[0] === 'ec2-instances' && inner[1]) {
        return {
          type: 'aws-ec2',
          teamId,
          accountId: parentId,
          instanceId: inner[1],
        }
      }
      if (inner[0] === 'lightsail' && inner[1] && inner[2] === 'instances' && inner[3]) {
        return {
          type: 'aws-lightsail',
          teamId,
          accountId: parentId,
          region: inner[1],
          name: inner[3],
        }
      }
      if (inner[0] === 'cloudformation' && inner[1] && inner[2]) {
        return {
          type: 'aws-cfn',
          teamId,
          accountId: parentId,
          region: inner[1],
          stackName: inner[2],
        }
      }
      if (inner[0] === 'ecs-clusters' && inner[1] && inner[2]) {
        return {
          type: 'aws-ecs-cluster',
          teamId,
          accountId: parentId,
          region: inner[1],
          clusterName: inner[2],
        }
      }
      if (inner[0] === 'eks-clusters') {
        return { type: 'aws-account', teamId, accountId: parentId }
      }
      if (inner[0] === 's3-buckets' && inner[1]) {
        const bucket = inner[1]
        const keyParts = inner.slice(2)

        if (keyParts.length === 0) {
          return {
            type: 'aws-s3',
            teamId,
            accountId: parentId,
            bucket,
            key: '',
            kind: 'bucket',
          }
        }
        const key = keyParts.join('/') + (trailingSlash ? '/' : '')

        return {
          type: 'aws-s3',
          teamId,
          accountId: parentId,
          bucket,
          key,
          kind: trailingSlash ? 'prefix' : 'object',
        }
      }
      if (inner[0] === 'clusters' && inner[1] && inner[2]) {
        return parseClusterOrResource(
          teamId,
          'aws',
          parentId,
          inner[1],
          inner[2],
          inner.slice(3),
          url,
        )
      }
    }
    if (provider === 'gcp') {
      if (inner.length === 0) {
        return { type: 'gcp-project', teamId, projectId: parentId }
      }
      if (inner[0] === 'vpcs' && inner[1]) {
        return {
          type: 'gcp-vpc',
          teamId,
          projectId: parentId,
          vpcId: inner[1],
        }
      }
      if (inner[0] === 'firewalls' && inner[1]) {
        return {
          type: 'gcp-firewall',
          teamId,
          projectId: parentId,
          name: inner[1],
        }
      }
      if (inner[0] === 'gke-clusters') {
        return { type: 'gcp-project', teamId, projectId: parentId }
      }
      if (inner[0] === 'clusters' && inner[1] && inner[2]) {
        return parseClusterOrResource(
          teamId,
          'gcp',
          parentId,
          inner[1],
          inner[2],
          inner.slice(3),
          url,
        )
      }
    }
    if (provider === 'cloudflare') {
      if (inner.length === 0) {
        return { type: 'cloudflare-account', teamId, accountId: parentId }
      }
      if (inner[0] === 'zones' && inner[1]) {
        const zoneId = inner[1]

        if (inner[2] === 'dns-records' && inner[3]) {
          return {
            type: 'cloudflare-dns',
            teamId,
            accountId: parentId,
            zoneId,
            recordId: inner[3],
          }
        }

        return {
          type: 'cloudflare-zone',
          teamId,
          accountId: parentId,
          zoneId,
        }
      }
    }
  }

  return null
}

function customResourceForPath(
  segments: string[],
): { apiVersion: string; kind: string; plural: string; namespaced: boolean } | null {
  if (segments.length !== 6 || segments[0] !== 'custom-resources') return null
  const [, group, version, kind, plural, scope] = segments

  if (!group || !version || !kind || !plural) return null
  if (scope !== 'namespaced' && scope !== 'cluster-scoped') return null

  return { apiVersion: `${group}/${version}`, kind, plural, namespaced: scope === 'namespaced' }
}

export function parseClusterOrResource(
  teamId: string,
  provider: KubernetesClusterProvider,
  parentId: string,
  region: string,
  clusterName: string,
  rest: string[],
  url: URL,
): MentionTarget {
  const customResource = customResourceForPath(rest.slice(0, 6))
  const detailSegments = customResource ? rest.slice(6) : rest
  const resIdx = detailSegments.indexOf('resources')

  if (resIdx >= 0 && detailSegments[resIdx + 1] && detailSegments[resIdx + 2]) {
    // `namespaces/<ns>` may appear immediately before `resources`. The
    // `?namespace=` fallback is the *browsing* filter, so it may only stand in
    // for a resource that can actually be namespaced.
    let namespace: string | null = null

    if (detailSegments[resIdx - 2] === 'namespaces' && detailSegments[resIdx - 1]) {
      namespace = detailSegments[resIdx - 1]
    } else if (customResource?.namespaced !== false) {
      namespace = url.searchParams.get('namespace') || null
    }

    return {
      type: 'k8s-resource',
      teamId,
      provider,
      parentId,
      region,
      clusterName,
      namespace,
      kind: customResource?.kind ?? detailSegments[resIdx + 1],
      name: detailSegments[resIdx + 2],
      ...(customResource
        ? {
            apiVersion: customResource.apiVersion,
            plural: customResource.plural,
            resourceKind: customResource.kind,
          }
        : {}),
    }
  }

  return {
    type: 'cluster',
    teamId,
    provider,
    parentId,
    region,
    clusterName,
  }
}
