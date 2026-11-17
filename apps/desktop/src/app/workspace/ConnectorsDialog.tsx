import { ArrowLeft } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Modal } from '../../components/Modal'
import { t } from '../../i18n'
import { TeamHomeView } from '../../views/CloudViews'
import { ConnectorInfoView } from '../../views/ConnectorInfoView'
import {
  connectorInfoActions,
  connectorInfoAttention,
  connectorInfoDisconnectAction,
} from '../scopeContent/connectorInfoActions'

import { connectorsDialogFor } from './store/connectorsDialog'
import { useMainPageConnectorInfo } from './useMainPageConnectorInfo'

import type { ConnectorsDialogState } from './store/connectorsDialog'
import type { WorkspaceController } from './useWorkspaceController'
import type { ConnectorDetailRef } from '../../lib/appRoutes'
import type { UserInfo } from '../../types'
import type { ConnectorInfoContext } from '../scopeContent/connectorInfoActions'

const ignoreCount = () => {
  // The dialog has no toolbar to show the list's row count on.
}

/**
 * Connectors, as a dialog over whatever the pane shows: the list, or one
 * connector's detail after Manage, with a back arrow to the list. Escape, the
 * close button or a click outside close it and leave the page where it was.
 */
export function ConnectorsDialog({ ws, user }: { ws: WorkspaceController; user: UserInfo }) {
  const { connectorsDialog, workspaceActions, workspaceStore } = ws
  const teamId = ws.scope?.teamId ?? ''
  const open = connectorsDialog !== null && teamId !== ''
  // The last open state keeps the panel's content on screen while it closes.
  const [shown, setShown] = useState<ConnectorsDialogState>(
    () => connectorsDialog ?? connectorsDialogFor(),
  )
  const [filter, setFilter] = useState('')
  const [wasOpen, setWasOpen] = useState(open)

  if (connectorsDialog && connectorsDialog !== shown) setShown(connectorsDialog)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setFilter('')
  }

  const close = useCallback(() => workspaceActions.setConnectorsDialog(null), [workspaceActions])
  const updateDialog = useCallback(
    (patch: Partial<ConnectorsDialogState>) => {
      const current = workspaceStore.getState().connectorsDialog

      if (current) workspaceActions.setConnectorsDialog({ ...current, ...patch })
    },
    [workspaceActions, workspaceStore],
  )
  const setDetail = useCallback(
    (detail: ConnectorDetailRef | null) => updateDialog({ detail }),
    [updateDialog],
  )
  const info = useMainPageConnectorInfo(ws, teamId, close)
  const { openSettingsSection, stableOpenAgentChatWithPrompt, refreshConnectors } = ws
  // Settings and a new chat both open behind the dialog; close it to show them.
  const onOpenSettingsSection = (section: string) => {
    close()
    openSettingsSection(section)
  }
  const onOpenAgentChat = (prompt: string, options?: { send?: boolean }) => {
    close()
    stableOpenAgentChatWithPrompt(prompt, options)
  }
  const { detail } = shown
  const infoContext: ConnectorInfoContext = {
    ...info,
    connectorDetail: detail,
    onAccountsChanged: refreshConnectors,
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={detail?.name ?? t('Connectors')}
      // The body's own heading names it on screen; the title stays for screen readers.
      titleHidden
      width={920}
      fillHeight
      focusFirstControl={false}
      headerInset="wide"
      headerDivider={false}
      headerLeading={
        detail ? (
          <button
            type="button"
            aria-label={t('Back')}
            onClick={() => setDetail(null)}
            className="-ml-1.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-state-hover hover:text-main"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : undefined
      }
    >
      {detail ? (
        <ConnectorDetail
          ws={ws}
          user={user}
          info={infoContext}
          detail={detail}
          onDetailChange={setDetail}
          onOpenAgentChat={onOpenAgentChat}
          onOpenSettingsSection={onOpenSettingsSection}
        />
      ) : (
        <ConnectorsList
          ws={ws}
          info={infoContext}
          filter={filter}
          onFilterChange={setFilter}
          addIntegrationOpen={shown.addIntegrationOpen}
          onAddIntegrationOpenChange={(addIntegrationOpen) => updateDialog({ addIntegrationOpen })}
          slackBindRequested={open && ws.slackBindRequested}
          onOpenAgentChat={onOpenAgentChat}
          onOpenSettingsSection={onOpenSettingsSection}
          onOpenConnectorInfo={setDetail}
        />
      )}
    </Modal>
  )
}

function ConnectorDetail({
  ws,
  user,
  info,
  detail,
  onDetailChange,
  onOpenAgentChat,
  onOpenSettingsSection,
}: {
  ws: WorkspaceController
  user: UserInfo
  info: ConnectorInfoContext
  detail: ConnectorDetailRef
  onDetailChange: (detail: ConnectorDetailRef | null) => void
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
  onOpenSettingsSection: (section: string) => void
}) {
  return (
    <ConnectorInfoView
      teamId={info.scope.teamId}
      currentUserId={user.id}
      provider={detail.provider}
      connectorId={detail.connectorId}
      refreshKey={ws.connectorsRefreshKey}
      inAppActionsForConnection={(id) => connectorInfoActions(info, id)}
      disconnectActionForConnection={(id) => connectorInfoDisconnectAction(info, id)}
      onpremCluster={(id) => info.accounts?.onprem.find((cluster) => cluster.id === id)}
      attentionForConnection={(id) => connectorInfoAttention(info, id)}
      onExit={() => onDetailChange(null)}
      onConnectionsChanged={ws.refreshConnectors}
      onOpenAgentChat={onOpenAgentChat}
      onOpenSettingsSection={onOpenSettingsSection}
      onNameResolved={(name) =>
        name === detail.name ? undefined : onDetailChange({ ...detail, name })
      }
    />
  )
}

function ConnectorsList({
  ws,
  info,
  filter,
  onFilterChange,
  addIntegrationOpen,
  onAddIntegrationOpenChange,
  slackBindRequested,
  onOpenAgentChat,
  onOpenSettingsSection,
  onOpenConnectorInfo,
}: {
  ws: WorkspaceController
  info: ConnectorInfoContext
  filter: string
  onFilterChange: (filter: string) => void
  addIntegrationOpen: boolean
  onAddIntegrationOpenChange: (open: boolean) => void
  slackBindRequested: boolean
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
  onOpenSettingsSection: (section: string) => void
  onOpenConnectorInfo: (detail: ConnectorDetailRef) => void
}) {
  const { accounts } = info

  return (
    <TeamHomeView
      teamId={info.scope.teamId}
      databaseConnections={info.databaseConnections ?? []}
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
      trelloIntegrations={accounts?.trello ?? []}
      instaboxAccounts={accounts?.instabox ?? []}
      tencentAccounts={accounts?.tencent ?? []}
      aliyunAccounts={accounts?.aliyun ?? []}
      volcengineAccounts={accounts?.volcengine ?? []}
      huaweiAccounts={accounts?.huawei ?? []}
      azureAccounts={accounts?.azure ?? []}
      betterStackIntegrations={accounts?.betterstack ?? []}
      uptimeKumaInstances={accounts?.uptimeKuma ?? []}
      tailscaleClients={accounts?.tailscale ?? []}
      zeaburProviders={accounts?.zeabur ?? []}
      githubInstallations={info.githubInstallations}
      gitlabBindings={info.gitlabBindings}
      grafanaInstances={info.grafanaInstances}
      linearWorkspaces={accounts?.linear ?? []}
      jiraSites={accounts?.jira ?? []}
      asanaAccounts={accounts?.asana ?? []}
      sentryAccounts={accounts?.sentry ?? []}
      posthogIntegrations={accounts?.posthog ?? []}
      plaudAccounts={accounts?.plaud ?? []}
      discordConnection={accounts?.discordConnection ?? null}
      slackInstallation={accounts?.slackInstallation ?? null}
      slackLinkedChannels={accounts?.slackLinkedChannels ?? null}
      larkInstallation={accounts?.larkInstallation ?? null}
      loading={!accounts}
      filter={filter}
      onFilterChange={onFilterChange}
      refreshKey={ws.connectorsRefreshKey}
      onCount={ignoreCount}
      onOpenAgentChat={onOpenAgentChat}
      addIntegrationOpen={addIntegrationOpen}
      onAddIntegrationOpenChange={onAddIntegrationOpenChange}
      slackBindRequested={slackBindRequested}
      onSlackBindHandled={ws.handleSlackBindRequested}
      onOpenSettingsSection={onOpenSettingsSection}
      onOpenConnectorInfo={onOpenConnectorInfo}
      onChanged={ws.refreshConnectors}
    />
  )
}
