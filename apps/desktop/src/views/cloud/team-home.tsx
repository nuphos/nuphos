import { Info, KeyRound, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ContextMenu } from '../../components/ContextMenu'
import { toast } from '../../components/ui/toast'
import { CONNECTOR_INFO_LABELS } from '../../lib/appRoutes'
import { ManageOnpremCredentialDialog } from '../ManageOnpremCredentialDialog'
import { useResetOnKey } from '../useResetOnKey'

import { applyFilter } from './shared'
import { TeamHomeBindFlow } from './team-home-bind-flow'
import { buildCloudConnectorRows } from './team-home-rows-cloud'
import { buildDevConnectorRows } from './team-home-rows-dev'
import { buildSaasConnectorRows } from './team-home-rows-saas'
import { IntegrationCatalog } from './team-home-table'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { TeamHomeBindFlowHandle } from './team-home-bind-flow'
import type { TeamHomeViewProps } from './team-home-props'
import type { OnpremCluster } from '../../types'

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
  const [menu, setMenu] = useState<{
    row: IntegrationPlatformRow
    x: number
    y: number
  } | null>(null)
  // Rows deleted this session, hidden immediately (optimistic) until the
  // aggregated connectors refetch catches up — otherwise a confirmed delete
  // lingers in the list for the ~1s the refetch takes and reads as "stuck".
  const [locallyRemoved, setLocallyRemoved] = useState<Set<string>>(new Set())
  const [manageOnpremAccess, setManageOnpremAccess] = useState<OnpremCluster | null>(null)
  const bindFlowRef = useRef<TeamHomeBindFlowHandle>(null)
  const openProviderInfo = (detail: Parameters<typeof onOpenConnectorInfo>[0]) =>
    onOpenConnectorInfo(detail)
  const openProviderGroup = (row: IntegrationPlatformRow) =>
    onOpenConnectorInfo({
      provider: row.provider,
      connectorId: 'all',
      name: CONNECTOR_INFO_LABELS[row.provider],
    })

  async function deleteIntegration(row: IntegrationPlatformRow) {
    if (!row.onDelete) return
    // Hide the row the INSTANT delete is requested (before the await) so it
    // feels immediate — the aggregated connectors refetch below takes ~1s, and
    // a row lingering after clicking Delete reads as "stuck". Restore on failure.
    setLocallyRemoved((prev) => new Set(prev).add(row.key))
    try {
      await row.onDelete()
    } catch (err) {
      toast.apiError('Could not remove connector', err)
      setLocallyRemoved((prev) => {
        const next = new Set(prev)

        next.delete(row.key)

        return next
      })
    } finally {
      // Refresh even on failure: a grouped unbind (e.g. an Azure subscription's
      // multiple apps) can partially succeed, so the list must re-sync rather
      // than keep showing already-deleted bindings until a manual reload.
      onChanged()
    }
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
      onManageOnpremAccess: setManageOnpremAccess,
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
      grafanaInstances,
      discordConnection,
      slackInstallation,
      slackLinkedChannels,
      larkInstallation,
      onOpenConnectorInfo: openProviderInfo,
    }),
  ]
  // Drop optimistic keys once the refetch no longer returns them, so a later
  // re-bind reappears and the set can't grow unbounded.
  const rowsKey = rows.map((r) => r.key).join('|')

  useResetOnKey(rowsKey, () => {
    setLocallyRemoved((prev) => {
      if (prev.size === 0) return prev
      const present = new Set(rowsKey ? rowsKey.split('|') : [])
      const next = new Set([...prev].filter((k) => present.has(k)))

      return next.size === prev.size ? prev : next
    })
  })
  const activeRows = rows.filter((row) => !locallyRemoved.has(row.key))
  const filtered = applyFilter(
    activeRows,
    filter,
    (row) => `${row.provider} ${row.account} ${row.principal} ${row.status}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'permissions',
              label: menu.row.onManageAccess ? 'Manage access' : 'Connector details',
              icon: menu.row.onManageAccess ? KeyRound : Info,
              disabled: !(menu.row.onManageAccess ?? menu.row.onAction),
              onSelect: () => (menu.row.onManageAccess ?? menu.row.onAction)?.(),
            },
            { key: 'sep', separator: true },
            {
              key: 'delete',
              label: 'Delete connector',
              icon: Trash2,
              destructive: true,
              disabled: !menu.row.onDelete,
              confirm: `Delete ${menu.row.account} connector?`,
              onSelect: () => void deleteIntegration(menu.row),
            },
          ]}
        />
      )}
      <IntegrationCatalog
        rows={activeRows}
        visibleRows={filtered}
        loading={loading}
        filter={filter}
        onFilterChange={onFilterChange}
        onAdd={(key, mode) => bindFlowRef.current?.openIntegration(key, mode)}
        onOpenInstalledGroup={(group) => openProviderGroup(group[0])}
        onRowContextMenu={(row, event) => setMenu({ row, x: event.clientX, y: event.clientY })}
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
      {manageOnpremAccess && (
        <ManageOnpremCredentialDialog
          teamId={teamId}
          cluster={manageOnpremAccess}
          onClose={() => setManageOnpremAccess(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  )
}
