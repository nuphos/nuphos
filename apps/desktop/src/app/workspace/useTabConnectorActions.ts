import { useCallback } from 'react'

import type { AwsAccount, GcpProject, Scope } from '../../types'
import type { WorkspaceTabState } from '../workspaceTabState'

export function useTabConnectorActions({
  tabId,
  tab,
  enterScopeInTab,
}: {
  tabId: string
  tab: WorkspaceTabState
  enterScopeInTab: (tabId: string, next: Scope, defaultActive?: string) => void
}) {
  const onPickAwsRole = useCallback(
    (role: AwsAccount) => {
      enterScopeInTab(
        tabId,
        {
          kind: 'aws-account',
          teamId: tab.scope.teamId,
          accountId: role.accountId,
          roleId: role.roleId,
          roleArn: role.roleArn,
        },
        'aws.role',
      )
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onPickGcpServiceAccount = useCallback(
    (serviceAccount: GcpProject) => {
      enterScopeInTab(
        tabId,
        {
          kind: 'gcp-project',
          teamId: tab.scope.teamId,
          projectId: serviceAccount.projectId,
          serviceAccountId: serviceAccount.serviceAccountId,
        },
        'gcp.service-account',
      )
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenAwsAccountRoles = useCallback(
    (accountId: string) => {
      enterScopeInTab(
        tabId,
        { kind: 'aws-account', teamId: tab.scope.teamId, accountId },
        'aws.roles',
      )
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenAwsAccountResources = useCallback(
    (accountId: string) => {
      enterScopeInTab(tabId, { kind: 'aws-account', teamId: tab.scope.teamId, accountId })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  // A connector scope whose binding vanished (deleted, or an engine we no longer
  // release) exits the same way every other connector scope does — back to the
  // team root, matching sidebarBackTarget.
  const onExitToConnectors = useCallback(() => {
    enterScopeInTab(tabId, { kind: 'team', teamId: tab.scope.teamId }, 'team.agent')
  }, [enterScopeInTab, tab.scope.teamId, tabId])
  // Arriving from the Connectors table lands on the connection's access policy,
  // mirroring AWS/GCP/Cloudflare, whose rows open their permission page rather
  // than their operational content. The sidebar entry still opens Overview.
  const onOpenDatabaseConnection = useCallback(
    (connectionId: string) => {
      enterScopeInTab(
        tabId,
        { kind: 'database-connection', teamId: tab.scope.teamId, connectionId },
        'database.access',
      )
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenDatabaseConnectionOverview = useCallback(
    (connectionId: string) => {
      enterScopeInTab(tabId, {
        kind: 'database-connection',
        teamId: tab.scope.teamId,
        connectionId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenAzureSubscriptionApps = useCallback(
    (subscriptionId: string) => {
      enterScopeInTab(
        tabId,
        { kind: 'azure-subscription', teamId: tab.scope.teamId, subscriptionId },
        'azure.apps',
      )
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenGcpProjectServiceAccounts = useCallback(
    (projectId: string) => {
      enterScopeInTab(
        tabId,
        { kind: 'gcp-project', teamId: tab.scope.teamId, projectId },
        'gcp.service-accounts',
      )
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenGcpProjectResources = useCallback(
    (projectId: string) => {
      enterScopeInTab(tabId, { kind: 'gcp-project', teamId: tab.scope.teamId, projectId })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenCloudflareAccountIam = useCallback(
    (accountId: string) => {
      enterScopeInTab(
        tabId,
        { kind: 'cloudflare-account', teamId: tab.scope.teamId, accountId },
        'cloudflare.iam',
      )
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenCloudflareAccountResources = useCallback(
    (accountId: string) => {
      enterScopeInTab(tabId, {
        kind: 'cloudflare-account',
        teamId: tab.scope.teamId,
        accountId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenLinodeAccount = useCallback(
    (accountId: string) => {
      enterScopeInTab(tabId, {
        kind: 'linode-account',
        teamId: tab.scope.teamId,
        accountId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenHetznerAccount = useCallback(
    (accountId: string) => {
      enterScopeInTab(tabId, {
        kind: 'hetzner-account',
        teamId: tab.scope.teamId,
        accountId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenTencentAccount = useCallback(
    (accountId: string) => {
      enterScopeInTab(tabId, {
        kind: 'tencent-account',
        teamId: tab.scope.teamId,
        accountId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenAliyunAccount = useCallback(
    (accountId: string) => {
      enterScopeInTab(tabId, {
        kind: 'aliyun-account',
        teamId: tab.scope.teamId,
        accountId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenVolcengineAccount = useCallback(
    (accountId: string) => {
      enterScopeInTab(tabId, {
        kind: 'volcengine-account',
        teamId: tab.scope.teamId,
        accountId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenBetterStackIntegration = useCallback(
    (integrationId: string) => {
      enterScopeInTab(tabId, {
        kind: 'betterstack-integration',
        teamId: tab.scope.teamId,
        integrationId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenUptimeKumaInstance = useCallback(
    (instanceId: string) => {
      enterScopeInTab(tabId, {
        kind: 'uptime-kuma-instance',
        teamId: tab.scope.teamId,
        instanceId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenTailscaleClient = useCallback(
    (clientId: string) => {
      enterScopeInTab(tabId, {
        kind: 'tailscale-client',
        teamId: tab.scope.teamId,
        clientId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )
  const onOpenZeaburProvider = useCallback(
    (zeaburId: string) => {
      enterScopeInTab(tabId, {
        kind: 'zeabur-provider',
        teamId: tab.scope.teamId,
        zeaburId,
      })
    },
    [enterScopeInTab, tab.scope.teamId, tabId],
  )

  return {
    onPickAwsRole,
    onPickGcpServiceAccount,
    onOpenAwsAccountRoles,
    onOpenAwsAccountResources,
    onExitToConnectors,
    onOpenDatabaseConnection,
    onOpenDatabaseConnectionOverview,
    onOpenAzureSubscriptionApps,
    onOpenGcpProjectServiceAccounts,
    onOpenGcpProjectResources,
    onOpenCloudflareAccountIam,
    onOpenCloudflareAccountResources,
    onOpenLinodeAccount,
    onOpenHetznerAccount,
    onOpenTencentAccount,
    onOpenAliyunAccount,
    onOpenVolcengineAccount,
    onOpenBetterStackIntegration,
    onOpenUptimeKumaInstance,
    onOpenTailscaleClient,
    onOpenZeaburProvider,
  }
}
