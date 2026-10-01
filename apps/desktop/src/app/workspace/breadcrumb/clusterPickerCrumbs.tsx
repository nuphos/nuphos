import { KeyRound, Server } from 'lucide-react'

import { awsRoleName, selectedAwsRoleArn } from '../../../app/accountScopes'
import { CloudLogo } from '../../../components/CloudLogo'

import type { BreadcrumbContext } from './breadcrumbContext'
import type { BreadcrumbSegment } from '../../../components/Toolbar'

export function pushClusterPickerCrumbs(ctx: BreadcrumbContext, out: BreadcrumbSegment[]): boolean {
  const {
    scope,
    active,
    accounts,
    clusterLabel,
    enterScope,
    enterCluster,
    clustersByParent,
    lkeClustersByAccount,
    loadLkeClustersForAccount,
  } = ctx

  if (scope.kind === 'cluster' && scope.parentKind === 'onprem-cluster') {
    // The connector crumb is also the cluster picker for on-prem clusters.
    // Do not repeat the same cluster as a second breadcrumb segment.
  } else if (scope.kind === 'cluster' && scope.parentKind === 'linode-account') {
    const parentId = scope.parentId
    const siblings = lkeClustersByAccount[`${scope.teamId}/${parentId}`]
    const currentClusterId = scope.linodeClusterId

    out.push({
      label: clusterLabel ?? scope.clusterName,
      isResource: true,
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      loading: !siblings,
      options: (siblings ?? []).map((c) => ({
        key: String(c.id),
        label: c.label,
        sublabel: c.k8s_version ? `${c.region} · v${c.k8s_version}` : c.region,
        selected: c.id === currentClusterId,
        onPick: () =>
          enterCluster({
            teamId: scope.teamId,
            parentKind: 'linode-account',
            parentId,
            cluster: c,
          }),
      })),
      onExpand: () => loadLkeClustersForAccount(scope.teamId, parentId),
      // Shown when the sibling fetch failed (we park an empty list); the
      // onExpand above has already kicked off a retry by the time it's read.
      emptyText: 'No clusters loaded — retrying…',
    })
  } else if (scope.kind === 'cluster') {
    const parentKind = scope.parentKind
    const cacheKey = `${parentKind}/${scope.parentId}/${scope.roleId ?? scope.serviceAccountId ?? 'auto'}`
    const siblings = clustersByParent[cacheKey]

    out.push({
      label: clusterLabel ?? scope.clusterName,
      isResource: true,
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      loading: !siblings,
      options: (siblings ?? []).map((c) => ({
        key: `${c.region}/${c.name}`,
        label: c.name,
        sublabel: c.version ? `${c.region} · v${c.version}` : c.region,
        selected: c.name === scope.clusterName && c.region === scope.region,
        onPick: () =>
          enterCluster({
            teamId: scope.teamId,
            parentKind,
            parentId: scope.parentId,
            cluster: c,
          }),
      })),
    })
  }

  if (scope.kind === 'aws-account' && active === 'aws.role') {
    const accountRoles =
      accounts?.aws.filter((a) => a.accountId === scope.accountId && a.canUse !== false) ?? []
    const selectedRoleArn = selectedAwsRoleArn(scope, accounts)

    out.push({
      label: 'Roles',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      onClick: () =>
        enterScope(
          {
            kind: 'aws-account',
            teamId: scope.teamId,
            accountId: scope.accountId,
          },
          'aws.roles',
        ),
    })
    out.push({
      label: selectedRoleArn ? awsRoleName(selectedRoleArn) : 'Role',
      isResource: true,
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      loading: !accounts,
      options: accountRoles.map((role) => ({
        key: role.roleId,
        label: awsRoleName(role.roleArn),
        sublabel: role.roleArn,
        icon: <CloudLogo provider="aws" size={16} />,
        selected: role.roleId === scope.roleId,
        onPick: () =>
          enterScope(
            {
              kind: 'aws-account',
              teamId: scope.teamId,
              accountId: scope.accountId,
              roleId: role.roleId,
              roleArn: role.roleArn,
            },
            'aws.role',
          ),
      })),
    })

    return true
  }

  if (scope.kind === 'gcp-project' && (active === 'gcp.service-account' || active === 'gcp.iam')) {
    const projectServiceAccounts =
      accounts?.gcp.filter((p) => p.projectId === scope.projectId && p.canUse !== false) ?? []
    const selectedServiceAccount =
      projectServiceAccounts.find((p) => p.serviceAccountId === scope.serviceAccountId) ??
      projectServiceAccounts[0]

    out.push({
      label: 'Service Accounts',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      onClick: () =>
        enterScope(
          {
            kind: 'gcp-project',
            teamId: scope.teamId,
            projectId: scope.projectId,
          },
          'gcp.service-accounts',
        ),
    })
    out.push({
      label: selectedServiceAccount?.serviceAccountEmail ?? 'Service Account',
      isResource: true,
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      loading: !accounts,
      options: projectServiceAccounts.map((serviceAccount) => ({
        key: serviceAccount.serviceAccountId,
        label: serviceAccount.serviceAccountEmail,
        sublabel: serviceAccount.projectId,
        icon: <CloudLogo provider="gcp" size={16} />,
        selected: serviceAccount.serviceAccountId === scope.serviceAccountId,
        onPick: () =>
          enterScope(
            {
              kind: 'gcp-project',
              teamId: scope.teamId,
              projectId: scope.projectId,
              serviceAccountId: serviceAccount.serviceAccountId,
            },
            'gcp.service-account',
          ),
      })),
    })

    return true
  }

  return false
}
