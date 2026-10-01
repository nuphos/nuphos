import { Cloud } from 'lucide-react'

import { TeamHomeView } from '../../views/CloudViews'
import { ConnectorInfoView } from '../../views/ConnectorInfoView'

import { connectorInfoActions, connectorInfoDisconnectAction } from './connectorInfoActions'

import type { ScopeRenderContext } from './context'

export function renderTeamHomePages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    currentUserId,
    filter,
    onFilterChange,
    refreshKey,
    accounts,
    githubInstallations,
    gitlabBindings,
    grafanaInstances,
    connectorDetail,
    setConnectorDetail,
    addIntegrationOpen,
    setAddIntegrationOpen,
    onOpenSettingsSection,
    slackBindRequested,
    onSlackBindHandled,
    onCount,
    databaseConnections,
    onAccountsChanged,
    onOpenAgentChat,
    renderPage,
  } = ctx

  if (scope.kind === 'team' && connectorDetail) {
    return renderPage(
      'team.integrations',
      connectorDetail.name,
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ConnectorInfoView
        teamId={scope.teamId}
        currentUserId={currentUserId}
        provider={connectorDetail.provider}
        connectorId={connectorDetail.connectorId}
        refreshKey={refreshKey}
        inAppActionsForConnection={(id) => connectorInfoActions(ctx, id)}
        disconnectActionForConnection={(id) => connectorInfoDisconnectAction(ctx, id)}
        onConnectionsChanged={onAccountsChanged}
        onOpenAgentChat={onOpenAgentChat}
        onOpenSettingsSection={onOpenSettingsSection}
        onNameResolved={(name) =>
          name === connectorDetail.name
            ? undefined
            : setConnectorDetail({ ...connectorDetail, name })
        }
      />,
    )
  }
  if (scope.kind === 'team') {
    return renderPage(
      'team.integrations',
      'Connectors',
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <TeamHomeView
        teamId={scope.teamId}
        databaseConnections={databaseConnections ?? []}
        awsAccounts={accounts?.aws ?? []}
        gcpProjects={accounts?.gcp ?? []}
        cloudflareAccounts={accounts?.cloudflare ?? []}
        linodeAccounts={accounts?.linode ?? []}
        hetznerAccounts={accounts?.hetzner ?? []}
        vantaIntegrations={accounts?.vanta ?? []}
        secureframeIntegrations={accounts?.secureframe ?? []}
        sonarqubeIntegrations={accounts?.sonarqube ?? []}
        notionIntegrations={accounts?.notion ?? []}
        onpremClusters={accounts?.onprem ?? []}
        upstashAccounts={accounts?.upstash ?? []}
        resendIntegrations={accounts?.resend ?? []}
        tencentAccounts={accounts?.tencent ?? []}
        aliyunAccounts={accounts?.aliyun ?? []}
        volcengineAccounts={accounts?.volcengine ?? []}
        huaweiAccounts={accounts?.huawei ?? []}
        azureAccounts={accounts?.azure ?? []}
        betterStackIntegrations={accounts?.betterstack ?? []}
        uptimeKumaInstances={accounts?.uptimeKuma ?? []}
        tailscaleClients={accounts?.tailscale ?? []}
        zeaburProviders={accounts?.zeabur ?? []}
        githubInstallations={githubInstallations}
        gitlabBindings={gitlabBindings}
        grafanaInstances={grafanaInstances}
        linearWorkspaces={accounts?.linear ?? []}
        jiraSites={accounts?.jira ?? []}
        asanaAccounts={accounts?.asana ?? []}
        sentryAccounts={accounts?.sentry ?? []}
        posthogIntegrations={accounts?.posthog ?? []}
        discordConnection={accounts?.discordConnection ?? null}
        slackInstallation={accounts?.slackInstallation ?? null}
        slackLinkedChannels={accounts?.slackLinkedChannels ?? null}
        larkInstallation={accounts?.larkInstallation ?? null}
        loading={!accounts}
        filter={filter}
        onFilterChange={onFilterChange}
        refreshKey={refreshKey}
        onCount={onCount}
        onOpenAgentChat={onOpenAgentChat}
        addIntegrationOpen={addIntegrationOpen}
        onAddIntegrationOpenChange={setAddIntegrationOpen}
        slackBindRequested={slackBindRequested}
        onSlackBindHandled={onSlackBindHandled}
        onOpenSettingsSection={onOpenSettingsSection}
        onOpenConnectorInfo={setConnectorDetail}
        onChanged={onAccountsChanged}
      />,
    )
  }

  return undefined
}
