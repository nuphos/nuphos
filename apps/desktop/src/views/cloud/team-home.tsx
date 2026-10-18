import { useEffect, useRef } from 'react'

import { CONNECTOR_INFO_LABELS } from '../../lib/appRoutes'

import { applyFilter } from './shared'
import { TeamHomeBindFlow } from './team-home-bind-flow'
import { buildCloudConnectorRows } from './team-home-rows-cloud'
import { buildDevConnectorRows } from './team-home-rows-dev'
import { buildSaasConnectorRows } from './team-home-rows-saas'
import { IntegrationCatalog } from './team-home-table'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { TeamHomeBindFlowHandle } from './team-home-bind-flow'
import type { TeamHomeViewProps } from './team-home-props'

export function TeamHomeView({
  teamId,
  awsAccounts,
  gcpProjects,
  cloudflareAccounts,
  linodeAccounts,
  hetznerAccounts,
  vantaIntegrations,
  secureframeIntegrations,
  sonarqubeIntegrations,
  notionIntegrations,
  onpremClusters,
  upstashAccounts,
  resendIntegrations,
  tencentAccounts,
  aliyunAccounts,
  volcengineAccounts,
  huaweiAccounts,
  azureAccounts,
  betterStackIntegrations,
  uptimeKumaInstances,
  tailscaleClients,
  zeaburProviders,
  githubInstallations,
  gitlabBindings,
  grafanaInstances,
  linearWorkspaces,
  jiraSites,
  asanaAccounts,
  sentryAccounts,
  posthogIntegrations,
  plaudAccounts,
  discordConnection,
  slackInstallation,
  larkInstallation,
  slackLinkedChannels,
  loading,
  filter,
  onFilterChange,
  onCount,
  databaseConnections,
  onOpenAgentChat,
  onOpenSettingsSection,
  onOpenConnectorInfo,
  onChanged,
  addIntegrationOpen,
  onAddIntegrationOpenChange,
  slackBindRequested = false,
  onSlackBindHandled,
}: TeamHomeViewProps) {
  const bindFlowRef = useRef<TeamHomeBindFlowHandle>(null)
  const openProviderInfo = (detail: Parameters<typeof onOpenConnectorInfo>[0]) =>
    onOpenConnectorInfo(detail)
  // One connection opens its own detail; several, or one without a detail page, open the provider's list.
  const openConnector = (group: IntegrationPlatformRow[]) => {
    const [row] = group

    if (group.length === 1 && row.onAction) {
      row.onAction()

      return
    }
    onOpenConnectorInfo({
      provider: row.provider,
      connectorId: 'all',
      name: CONNECTOR_INFO_LABELS[row.provider],
    })
  }

  const rows: IntegrationPlatformRow[] = [
    ...buildCloudConnectorRows({
      teamId,
      awsAccounts,
      gcpProjects,
      cloudflareAccounts,
      linodeAccounts,
      hetznerAccounts,
      onpremClusters,
      betterStackIntegrations,
      databaseConnections,
      uptimeKumaInstances,
      tailscaleClients,
      zeaburProviders,
      onOpenConnectorInfo: openProviderInfo,
    }),
    ...buildSaasConnectorRows({
      teamId,
      vantaIntegrations,
      secureframeIntegrations,
      sonarqubeIntegrations,
      notionIntegrations,
      upstashAccounts,
      resendIntegrations,
      tencentAccounts,
      aliyunAccounts,
      volcengineAccounts,
      huaweiAccounts,
      azureAccounts,
      onOpenConnectorInfo: openProviderInfo,
    }),
    ...buildDevConnectorRows({
      teamId,
      githubInstallations,
      gitlabBindings,
      linearWorkspaces,
      jiraSites,
      asanaAccounts,
      sentryAccounts,
      posthogIntegrations,
      plaudAccounts,
      grafanaInstances,
      discordConnection,
      slackInstallation,
      slackLinkedChannels,
      larkInstallation,
      onOpenConnectorInfo: openProviderInfo,
    }),
  ]
  const filtered = applyFilter(
    rows,
    filter,
    (row) => `${row.provider} ${row.account} ${row.principal} ${row.status}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <IntegrationCatalog
        rows={rows}
        visibleRows={filtered}
        githubInstallations={githubInstallations}
        loading={loading}
        filter={filter}
        onFilterChange={onFilterChange}
        onAdd={(key) => bindFlowRef.current?.openIntegration(key)}
        onOpen={openConnector}
      />
      <TeamHomeBindFlow
        ref={bindFlowRef}
        teamId={teamId}
        onOpenAgentChat={onOpenAgentChat}
        onOpenSettingsSection={onOpenSettingsSection}
        onChanged={onChanged}
        onFocusConnector={openProviderInfo}
        addIntegrationOpen={addIntegrationOpen}
        onAddIntegrationOpenChange={onAddIntegrationOpenChange}
        slackBindRequested={slackBindRequested}
        onSlackBindHandled={onSlackBindHandled}
      />
    </div>
  )
}
