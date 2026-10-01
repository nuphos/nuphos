import type { Scope } from '../types'

// Namespace and the selected resource are navigation state, not connection
// identity. Provider IDs and credential selections must still match.
export function clusterConnectionKey(scope: Scope): string | null {
  if (scope.kind !== 'cluster') return null
  let id: string | number = scope.clusterName

  switch (scope.parentKind) {
    case 'aws-account':
    case 'gcp-project':
      break
    case 'onprem-cluster':
      id = scope.onpremClusterId
      break
    case 'linode-account':
      id = scope.linodeClusterId
      break
    case 'tencent-account':
      id = scope.tencentClusterId
      break
    case 'aliyun-account':
      id = scope.aliyunClusterId
      break
    case 'volcengine-account':
      id = scope.volcengineClusterId
      break
  }

  return JSON.stringify([
    scope.teamId,
    scope.parentKind,
    scope.parentId,
    scope.provider,
    scope.region,
    id,
    scope.roleId,
    scope.serviceAccountId,
  ])
}
