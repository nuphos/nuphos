import { customResourceNavigationKey } from '../customResourceNavigation.ts'
import { clusterScopeFromRoute, isKubernetesClusterProvider } from '../kubernetesClusterRoutes.ts'

import { customResourceForPageSegments } from './customResources.ts'
import { activeKeyForDetailKind, detailKindFromUrlSegment } from './detailKinds.ts'
import { clusterActiveForPageSegments, emptyNavigation } from './parseShared.ts'
import { DEFAULT_KEY } from './types.ts'

import type { NavigationSnapshot } from './types.ts'
import type { Scope } from '../../types'
import type { KubernetesClusterProvider } from '../kubernetesClusterRoutes.ts'

function clusterNavigation(
  teamId: string,
  provider: KubernetesClusterProvider,
  connectionId: string,
  region: string,
  clusterId: string,
  credentialId: string | null,
  pageSegs: string[],
  query: URLSearchParams,
): NavigationSnapshot | null {
  const scope = clusterScopeFromRoute({
    teamId,
    provider,
    connectionId,
    region,
    clusterId,
    ...(credentialId ? { credentialId } : {}),
  })

  if (!scope) return null
  const namespace = query.get('namespace') ?? undefined

  return clusterNavigationForScope(namespace ? { ...scope, namespace } : scope, pageSegs)
}

function clusterNavigationForScope(
  scope: Extract<Scope, { kind: 'cluster' }>,
  pageSegs: string[],
): NavigationSnapshot {
  const customResource = customResourceForPageSegments(pageSegs.slice(0, 6))
  const detailSegments = customResource ? pageSegs.slice(6) : pageSegs
  const resIdx = detailSegments.indexOf('resources')

  if (resIdx >= 0 && detailSegments[resIdx + 1] && detailSegments[resIdx + 2]) {
    const kind = detailKindFromUrlSegment(detailSegments[resIdx + 1])

    if (kind) {
      let targetNamespace: string | null = null
      let pageEnd = resIdx

      if (
        resIdx >= 2 &&
        detailSegments[resIdx - 2] === 'namespaces' &&
        detailSegments[resIdx - 1]
      ) {
        targetNamespace = detailSegments[resIdx - 1]
        pageEnd = resIdx - 2
      }
      const pageSegments = customResource ? pageSegs.slice(0, 6) : detailSegments.slice(0, pageEnd)
      const active =
        (customResource
          ? customResourceNavigationKey(customResource)
          : clusterActiveForPageSegments(pageSegments)) ?? activeKeyForDetailKind(kind)

      return emptyNavigation(scope, active, {
        target: {
          kind,
          namespace: targetNamespace,
          name: detailSegments[resIdx + 2],
          ...(kind === 'CustomResource' && customResource
            ? {
                apiVersion: customResource.apiVersion,
                resourceKind: customResource.kind,
                plural: customResource.plural,
              }
            : {}),
        },
      })
    }
  }

  const active =
    (customResource
      ? customResourceNavigationKey(customResource)
      : clusterActiveForPageSegments(pageSegs)) ?? DEFAULT_KEY.cluster

  return emptyNavigation(scope, active)
}

export function kubernetesNavigation(
  teamId: string,
  inner: string[],
  query: URLSearchParams,
): NavigationSnapshot | null {
  const [provider, connectionId, region, clusterId, ...pageSegs] = inner

  if (!connectionId || !region || !clusterId || !isKubernetesClusterProvider(provider)) {
    return null
  }

  return clusterNavigation(
    teamId,
    provider,
    connectionId,
    region,
    clusterId,
    query.get('credential'),
    pageSegs,
    query,
  )
}
