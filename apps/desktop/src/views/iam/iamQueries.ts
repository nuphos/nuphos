import { queryOptions } from '@tanstack/react-query'

import { api } from '../../api.ts'
import { queryKeys } from '../../lib/query/keys.ts'

// Keyed by the principal shown, so switching it never shows the previous one's permissions.
export const awsPermissionsQuery = (teamId: string, accountId: string, roleId?: string) =>
  queryOptions({
    queryKey: queryKeys.iamPermissions(teamId, 'aws', accountId, roleId),
    queryFn: () => api.atlasGetAwsIamPermissions(teamId, accountId, roleId),
  })

export const gcpPermissionsQuery = (teamId: string, projectId: string, accountId?: string) =>
  queryOptions({
    queryKey: queryKeys.iamPermissions(teamId, 'gcp', projectId, accountId),
    queryFn: () => api.atlasGetGcpIamPermissions(teamId, projectId, accountId),
  })

export const cloudflarePermissionsQuery = (teamId: string, accountId: string) =>
  queryOptions({
    queryKey: queryKeys.iamPermissions(teamId, 'cloudflare', accountId),
    queryFn: () => api.atlasGetCloudflareIamPermissions(teamId, accountId),
  })
