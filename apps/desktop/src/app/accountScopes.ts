import { resourceListCacheKey } from '../lib/resourceListCache'

import { withStoredClusterNamespace } from './clusterNamespaceStorage'

import type { NavigationSnapshot } from '../lib/appRoutes'
import type { AwsAccount, Scope } from '../types'
import type { AccountSet } from './workspaceTabState'

export function awsRoleName(roleArn: string): string {
  return roleArn.split('/').pop() || roleArn
}

export function selectedAwsRole(
  scope: Scope,
  accounts: AccountSet | undefined,
): AwsAccount | undefined {
  if (scope.kind !== 'aws-account') return undefined
  const roles =
    accounts?.aws.filter((a) => a.accountId === scope.accountId && a.canUse !== false) ?? []

  // An explicitly-picked role resolves even if it's a permission-admin binding
  // (its settings detail page must render), but the auto-selection fallback
  // must never land on one — those are human-only break-glass credentials.
  return (
    roles.find((a) => a.roleId === scope.roleId) ??
    roles.find((a) => a.purpose !== 'permission-admin')
  )
}

export function selectedAwsRoleId(
  scope: Scope,
  accounts: AccountSet | undefined,
): string | undefined {
  if (scope.kind !== 'aws-account') return undefined

  return scope.roleId ?? selectedAwsRole(scope, accounts)?.roleId
}

export function selectedAwsRoleArn(
  scope: Scope,
  accounts: AccountSet | undefined,
): string | undefined {
  if (scope.kind !== 'aws-account') return undefined

  return scope.roleArn ?? selectedAwsRole(scope, accounts)?.roleArn
}

export function awsResourceListCacheKey(
  teamId: string,
  accountId: string,
  roleId: string | undefined,
  resource: string,
  extra?: string,
): string | undefined {
  // Don't cache while the role is unresolved (accounts still loading). Caching
  // under a placeholder "auto" bucket would let a later session hydrate from a
  // list fetched under a different auto-selected role, briefly showing the
  // wrong resource set before revalidation. Returning undefined disables the
  // cache for this loader until the real role id is known.
  if (!roleId) return undefined

  return resourceListCacheKey('aws', [teamId, accountId, roleId, resource, extra])
}

export function selectedGcpServiceAccountId(
  scope: Scope,
  accounts: AccountSet | undefined,
): string | undefined {
  if (scope.kind !== 'gcp-project') return undefined

  // The auto-selection fallback skips permission-admin SAs (human-only).
  return (
    scope.serviceAccountId ??
    accounts?.gcp.find(
      (p) =>
        p.projectId === scope.projectId && p.canUse !== false && p.purpose !== 'permission-admin',
    )?.serviceAccountId
  )
}

export function hydrateNavigationCredentialState(
  navigation: NavigationSnapshot,
  accountsByTeam: Record<string, AccountSet | undefined>,
): NavigationSnapshot {
  const { scope } = navigation

  if (scope.kind === 'aws-ecs-cluster') {
    const roleId =
      scope.roleId ??
      accountsByTeam[scope.teamId]?.aws.find(
        (role) =>
          role.accountId === scope.accountId &&
          role.canUse !== false &&
          role.purpose !== 'permission-admin',
      )?.roleId

    return {
      ...navigation,
      scope: roleId ? { ...scope, roleId } : scope,
    }
  }
  if (scope.kind !== 'cluster') return navigation

  const accounts = accountsByTeam[scope.teamId]
  const scopeWithNamespace = scope.namespace == null ? withStoredClusterNamespace(scope) : scope

  if (scopeWithNamespace.parentKind === 'aws-account') {
    const roleId =
      scopeWithNamespace.roleId ??
      accounts?.aws.find(
        (role) =>
          role.accountId === scopeWithNamespace.parentId &&
          role.canUse !== false &&
          role.purpose !== 'permission-admin',
      )?.roleId

    return {
      ...navigation,
      scope: roleId ? { ...scopeWithNamespace, roleId } : scopeWithNamespace,
    }
  }
  if (scopeWithNamespace.parentKind === 'gcp-project') {
    const serviceAccountId =
      scopeWithNamespace.serviceAccountId ??
      accounts?.gcp.find(
        (project) =>
          project.projectId === scopeWithNamespace.parentId &&
          project.canUse !== false &&
          project.purpose !== 'permission-admin',
      )?.serviceAccountId

    return {
      ...navigation,
      scope: serviceAccountId ? { ...scopeWithNamespace, serviceAccountId } : scopeWithNamespace,
    }
  }

  return { ...navigation, scope: scopeWithNamespace }
}
