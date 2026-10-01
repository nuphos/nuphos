import { KeyRound } from 'lucide-react'

import { CloudLogo } from '../../components/CloudLogo'
import { awsRoleName } from '../accountScopes'

import type { BreadcrumbSegment } from '../../components/Toolbar'
import type { Scope } from '../../types'
import type { AccountSet, WorkspaceTabState } from '../workspaceTabState'

export function computeIdentitySegment({
  scope,
  accounts,
  active,
  updateActiveTab,
}: {
  scope: Scope | null
  accounts: AccountSet | undefined
  active: string
  updateActiveTab: (updater: (tab: WorkspaceTabState) => WorkspaceTabState) => void
}): BreadcrumbSegment | undefined {
  if (!scope || !accounts) return
  if (scope.kind === 'aws-account') {
    if (active === 'aws.roles' || active === 'aws.role') return
    // Permission-admin roles are human-only break-glass bindings — never
    // offer them as a working identity in the switcher.
    const options = accounts.aws.filter(
      (a) =>
        a.accountId === scope.accountId && a.canUse !== false && a.purpose !== 'permission-admin',
    )

    if (options.length <= 1) return
    const selected = options.find((a) => a.roleId === scope.roleId) ?? options[0]

    return {
      label: selected ? awsRoleName(selected.roleArn) : 'AWS role',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      options: options.map((a) => ({
        key: a.roleId,
        label: awsRoleName(a.roleArn),
        sublabel: a.roleArn,
        icon: <CloudLogo provider="aws" size={16} />,
        selected: (scope.roleId ?? selected?.roleId) === a.roleId,
        onPick: () =>
          updateActiveTab((tab) => ({
            ...tab,
            scope:
              tab.scope.kind === 'aws-account'
                ? { ...tab.scope, roleId: a.roleId, roleArn: a.roleArn }
                : tab.scope,
            refreshKey: tab.refreshKey + 1,
            target: null,
            s3Detail: null,
          })),
      })),
    }
  }
  if (scope.kind === 'gcp-project') {
    if (
      active === 'gcp.service-accounts' ||
      active === 'gcp.service-account' ||
      active === 'gcp.iam'
    ) {
      return
    }
    // Same as AWS above: permission-admin SAs never appear as a working identity.
    const options = accounts.gcp.filter(
      (p) =>
        p.projectId === scope.projectId && p.canUse !== false && p.purpose !== 'permission-admin',
    )

    if (options.length <= 1) return
    const selected =
      options.find((p) => p.serviceAccountId === scope.serviceAccountId) ?? options[0]

    return {
      label: selected?.serviceAccountEmail ?? 'Service account',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      options: options.map((p) => ({
        key: p.serviceAccountId,
        label: p.serviceAccountEmail,
        sublabel: p.projectId,
        icon: <CloudLogo provider="gcp" size={16} />,
        selected: (scope.serviceAccountId ?? selected?.serviceAccountId) === p.serviceAccountId,
        onPick: () =>
          updateActiveTab((tab) => ({
            ...tab,
            scope:
              tab.scope.kind === 'gcp-project'
                ? { ...tab.scope, serviceAccountId: p.serviceAccountId }
                : tab.scope,
            refreshKey: tab.refreshKey + 1,
            target: null,
          })),
      })),
    }
  }

  return undefined
}
