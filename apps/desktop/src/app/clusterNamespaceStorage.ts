import { DEFAULT_KEY, emptyNavigation, pageLocationForNavigation } from '../lib/appRoutes'
import { toAbsoluteAtlasUrl } from '../lib/webBaseUrl'

import { readLocalStorage, writeLocalStorage } from './localStorage'
import { CLUSTER_NAMESPACE_STORAGE_PREFIX } from './workspaceTabState'

import type { Scope } from '../types'

// Discriminating id of a cluster within its account. Linode (numeric id) and
// Tencent (cls-xxxx) can have several clusters sharing a display name, so key on
// the provider id where one exists; AWS/GCP clusters are unique by name.
export function clusterScopeClusterId(scope: Extract<Scope, { kind: 'cluster' }>): string {
  return scope.parentKind === 'linode-account'
    ? String(scope.linodeClusterId)
    : scope.parentKind === 'tencent-account'
      ? scope.tencentClusterId
      : scope.parentKind === 'aliyun-account'
        ? scope.aliyunClusterId
        : scope.parentKind === 'volcengine-account'
          ? scope.volcengineClusterId
          : scope.clusterName
}

function clusterNamespaceStorageKey(scope: Extract<Scope, { kind: 'cluster' }>): string {
  const clusterId =
    scope.parentKind === 'linode-account' ||
    scope.parentKind === 'tencent-account' ||
    scope.parentKind === 'aliyun-account' ||
    scope.parentKind === 'volcengine-account'
      ? clusterScopeClusterId(scope)
      : `${scope.region}:${scope.clusterName}`

  return `${CLUSTER_NAMESPACE_STORAGE_PREFIX}${[
    scope.teamId,
    scope.parentKind,
    scope.parentId,
    clusterId,
  ]
    .map(encodeURIComponent)
    .join(':')}`
}

export function readStoredClusterNamespace(
  scope: Extract<Scope, { kind: 'cluster' }>,
): string | null {
  return readLocalStorage(clusterNamespaceStorageKey(scope))
}

export function writeStoredClusterNamespace(
  scope: Extract<Scope, { kind: 'cluster' }>,
  namespace: string,
) {
  writeLocalStorage(clusterNamespaceStorageKey(scope), namespace)
}

export function withStoredClusterNamespace<T extends Extract<Scope, { kind: 'cluster' }>>(
  scope: T,
): T {
  const namespace = readStoredClusterNamespace(scope)

  if (namespace === null) return scope

  return { ...scope, namespace: namespace || undefined }
}

/** Shareable link for a row in a provider's cluster list — the same canonical
 *  URL the tab lands on, so copy-link and open-in-tab agree. */
export function clusterRowHref(scope: Extract<Scope, { kind: 'cluster' }>): string {
  return toAbsoluteAtlasUrl(
    pageLocationForNavigation(emptyNavigation(scope, DEFAULT_KEY.cluster)).href,
  )
}
