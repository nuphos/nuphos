/* eslint-disable @typescript-eslint/no-explicit-any */
import { appendQuery, call } from './http.ts'

export function bindingsMethods(): Record<string, any> {
  return {
    atlasBindAwsAccount: (teamId: string, roleArn: string) =>
      call('POST', `/teams/${teamId}/aws-accounts`, { roleArn }),
    atlasUnbindAwsAccount: (teamId: string, accountId: string, roleId?: string) =>
      call('DELETE', appendQuery(`/teams/${teamId}/aws-accounts/${accountId}`, { roleId })),
    atlasGetAwsAccountAccess: (teamId: string, accountId: string, roleId?: string) =>
      call('GET', appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/access`, { roleId })),
    atlasUpdateAwsAccountAccess: (
      teamId: string,
      accountId: string,
      access: unknown,
      roleId?: string,
    ) =>
      call(
        'PUT',
        appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/access`, { roleId }),
        access,
      ),
    atlasBindGcpProject: (teamId: string, serviceAccountEmail: string, projectId: string) =>
      call('POST', `/teams/${teamId}/gcp-projects`, {
        serviceAccountEmail,
        projectId,
      }),
    atlasListPermissionGrantProposals: (teamId: string) =>
      call('GET', `/teams/${teamId}/permission-grant-proposals`),
    atlasGetPermissionGrantProposal: (teamId: string, id: string) =>
      call('GET', `/teams/${teamId}/permission-grant-proposals/${id}`),
    atlasApprovePermissionGrantProposal: (teamId: string, id: string) =>
      call('POST', `/teams/${teamId}/permission-grant-proposals/${id}/approve`),
    atlasRejectPermissionGrantProposal: (teamId: string, id: string) =>
      call('POST', `/teams/${teamId}/permission-grant-proposals/${id}/reject`),
    atlasUnbindGcpProject: (teamId: string, projectId: string, serviceAccountId?: string) =>
      call(
        'DELETE',
        appendQuery(`/teams/${teamId}/gcp-projects/${projectId}`, { serviceAccountId }),
      ),
    atlasGetGcpProjectAccess: (teamId: string, projectId: string, serviceAccountId?: string) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/gcp-projects/${projectId}/access`, { serviceAccountId }),
      ),
    atlasUpdateGcpProjectAccess: (
      teamId: string,
      projectId: string,
      access: unknown,
      serviceAccountId?: string,
    ) =>
      call(
        'PUT',
        appendQuery(`/teams/${teamId}/gcp-projects/${projectId}/access`, { serviceAccountId }),
        access,
      ),
    atlasBindCloudflareAccount: (teamId: string, accountId: string, apiKey: string) =>
      call('POST', `/teams/${teamId}/cloudflare-accounts`, { accountId, apiKey }),
    atlasUnbindCloudflareAccount: (teamId: string, accountId: string) =>
      call('DELETE', `/teams/${teamId}/cloudflare-accounts/${accountId}`),
    atlasListTailscaleClients: (teamId: string) =>
      call('GET', `/teams/${teamId}/tailscale-clients`).then((d: any) => d.clients ?? []),
    atlasBindTailscaleClient: (
      teamId: string,
      label: string,
      clientId: string,
      clientSecret: string,
    ) => call('POST', `/teams/${teamId}/tailscale-clients`, { label, clientId, clientSecret }),
    atlasUnbindTailscaleClient: (teamId: string, clientId: string) =>
      call('DELETE', `/teams/${teamId}/tailscale-clients/${clientId}`),
    atlasListTailscaleDevices: (teamId: string, clientId: string) =>
      call('GET', `/teams/${teamId}/tailscale-clients/${clientId}/devices`).then(
        (d: any) => d.devices ?? [],
      ),
  }
}
