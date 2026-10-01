import { Database, KeyRound, Server } from 'lucide-react'

import { api } from '../../api'
import { awsResourceListCacheKey } from '../../app/accountScopes'
import { clusterRowHref } from '../../app/clusterNamespaceStorage'
import { withResourceListCache } from '../../lib/resourceListCache'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import { CloudClustersView, S3BucketsView } from '../../views/CloudViews'
import { AwsRolesView } from '../../views/IamPermissionsView'

import type { ScopeRenderContext } from './context'

export function renderAwsIamStoragePages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    filter,
    refreshKey,
    accounts,
    s3Detail,
    setS3Detail,
    onCount,
    onLoading,
    onPickAwsRole,
    onOpenAwsAccountRoles,
    onPickCluster,
    onAccountsChanged,
    onOpenAgentChat,
    renderPage,
    renderActiveNavPage,
    awsRoleId,
  } = ctx

  if (scope.kind !== 'aws-account') return undefined

  if (active === 'aws.roles' || active === 'aws.role') {
    const roles =
      accounts?.aws.filter((role) => role.accountId === scope.accountId && role.canUse !== false) ??
      []
    const selectedRole =
      active === 'aws.role'
        ? ((scope.roleId ? roles.find((item) => item.roleId === scope.roleId) : undefined) ??
          (scope.roleArn ? roles.find((item) => item.roleArn === scope.roleArn) : undefined))
        : undefined

    return renderActiveNavPage(
      'Roles',
      <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <AwsRolesView
        teamId={scope.teamId}
        accountId={scope.accountId}
        roles={roles}
        filter={filter}
        selectedRoleId={selectedRole?.roleId}
        refreshKey={refreshKey}
        onLoading={onLoading}
        onCount={onCount}
        onPick={onPickAwsRole}
        onAccessChanged={onAccountsChanged}
        onCloseDetail={() => onOpenAwsAccountRoles(scope.accountId)}
        onOpenAgentChat={onOpenAgentChat}
      />,
    )
  }
  if (active === 'aws.s3') {
    const s3FolderName = s3Detail?.prefix
      ? (s3Detail.prefix.replace(/\/$/, '').split('/').pop() ?? '')
      : ''
    const s3Title = s3Detail
      ? s3FolderName
        ? `${s3Detail.bucket} / ${s3FolderName}`
        : s3Detail.bucket
      : 'S3 Buckets'

    return renderPage(
      'aws.s3',
      s3Title,
      <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <S3BucketsView
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 's3-buckets'),
          () => api.atlasListAwsS3Buckets(scope.teamId, scope.accountId, awsRoleId),
        )}
        objectLoader={(bucket, prefix, token) =>
          api.atlasListAwsS3BucketObjects(
            scope.teamId,
            scope.accountId,
            bucket.name,
            bucket.region,
            prefix,
            token,
            awsRoleId,
          )
        }
        downloadUrlLoader={(bucket, key) =>
          api.atlasGetAwsS3ObjectDownloadUrl(
            scope.teamId,
            scope.accountId,
            bucket.name,
            bucket.region,
            key,
            awsRoleId,
          )
        }
        previewLoader={(bucket, key) =>
          api.atlasGetAwsS3ObjectPreview(
            scope.teamId,
            scope.accountId,
            bucket.name,
            bucket.region,
            key,
            awsRoleId,
          )
        }
        s3Detail={s3Detail}
        setS3Detail={setS3Detail}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(b) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/aws/${encodeURIComponent(scope.accountId)}/s3-buckets/${encodeURIComponent(b.name)}`,
          )
        }
      />,
    )
  }

  return renderActiveNavPage(
    'EKS Clusters',
    <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    <CloudClustersView
      loader={withResourceListCache(
        awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'eks-clusters'),
        () => api.atlasListAwsClusters(scope.teamId, scope.accountId, awsRoleId),
      )}
      filter={filter}
      refreshKey={refreshKey}
      onCount={onCount}
      onLoading={onLoading}
      onPick={onPickCluster}
      getRowLink={(c) =>
        clusterRowHref({
          kind: 'cluster',
          teamId: scope.teamId,
          parentKind: 'aws-account',
          parentId: scope.accountId,
          clusterName: c.name,
          provider: 'aws',
          region: c.region,
          ...(awsRoleId ? { roleId: awsRoleId } : {}),
        })
      }
    />,
  )
}
