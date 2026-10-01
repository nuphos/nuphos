import { BindingAccessSection } from '../../components/BindingAccess'
import { LarkSettingsView } from '../LarkSettingsView'
import { SlackSettingsView } from '../SlackSettingsView'
import { TailscalePrivateNetworkPanel } from '../TailscalePrivateNetworkPanel'

import { ACCESS_EDITABLE_PROVIDERS } from './managementProviders'
import { PosthogConnectorGuide } from './PosthogConnectorGuide'
import { SonarqubeConnectorGuide } from './SonarqubeConnectorGuide'

import type { ConnectorInfo } from './types'
import type { ConnectorInfoProvider } from '../../lib/appRoutes'

export function ConnectorManagementSection({
  teamId,
  currentUserId,
  provider,
  connectorId,
  info,
  refreshKey,
  onOpenAgentChat,
  onChanged,
}: {
  teamId: string
  currentUserId: string
  provider: ConnectorInfoProvider
  connectorId: string
  info: ConnectorInfo
  refreshKey: number
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
  onChanged: () => void
}) {
  const accessProvider = ACCESS_EDITABLE_PROVIDERS[provider]

  if (provider === 'slack') {
    return (
      <SlackSettingsView
        teamId={teamId}
        currentUserId={currentUserId}
        embedded
        onChanged={onChanged}
      />
    )
  }

  if (provider === 'lark') {
    return (
      <LarkSettingsView
        teamId={teamId}
        currentUserId={currentUserId}
        refreshKey={refreshKey}
        onChanged={onChanged}
      />
    )
  }

  if (provider === 'sonarqube') {
    return (
      <SonarqubeConnectorGuide
        teamId={teamId}
        connectorId={connectorId}
        connectorName={info.name}
        refreshKey={refreshKey}
        onOpenAgentChat={onOpenAgentChat}
      />
    )
  }

  if (provider === 'tailscale') {
    return (
      <TailscalePrivateNetworkPanel
        teamId={teamId}
        connectorId={connectorId}
        sandboxAccess={info.tailscaleSandboxAccess}
      />
    )
  }

  if (!accessProvider) return null

  const accessSection = (
    <div className="-mx-4 -my-5 [&>section]:border-t-0">
      <BindingAccessSection
        teamId={teamId}
        provider={accessProvider}
        resourceId={connectorId}
        refreshKey={refreshKey}
      />
    </div>
  )

  if (provider === 'posthog') {
    return (
      <>
        <PosthogConnectorGuide
          teamId={teamId}
          connectorId={connectorId}
          refreshKey={refreshKey}
          onChanged={onChanged}
        />
        <div className="mt-8">{accessSection}</div>
      </>
    )
  }

  return accessSection
}
