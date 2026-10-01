import { useEffect, useRef, useState } from 'react'

import { toast } from '../components/ui/toast'
import { CONNECTOR_INFO_LABELS } from '../lib/appRoutes'

import { installedConnectorAddAction } from './cloud/connector-actions'
import { TeamHomeBindFlow } from './cloud/team-home-bind-flow'
import { ConnectorInfoPage } from './connector-info/ConnectorInfoPage'
import { ConnectorManagementSection } from './connector-info/ConnectorManagementSection'
import { DisconnectConnectorDialog } from './connector-info/DisconnectConnectorDialog'
import { loadConnectorInfos } from './connector-info/loadConnectorInfo'
import { hasConnectorManagement } from './connector-info/managementProviders'
import { useResetOnKey } from './useResetOnKey'

import type { ConnectorInfoProvider } from '../lib/appRoutes'
import type { TeamHomeBindFlowHandle } from './cloud/team-home-bind-flow'
import type { ConnectorInfoAction } from './connector-info/ConnectorInfoPage'
import type { DisconnectTarget } from './connector-info/DisconnectConnectorDialog'
import type { LoadedConnectorInfo } from './connector-info/loadConnectorInfo'

// Every installed connector row opens this shared info page. Providers with a
// resource browser expose it as a primary action; providers with management UI
// render that UI below the same identity, connection, and information shell.
export {
  CONNECTOR_INFO_PROVIDERS,
  CONNECTOR_INFO_LABELS,
  type ConnectorInfoProvider,
} from '../lib/appRoutes'

function ConnectorInfoSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[760px] animate-pulse px-7 py-10"
      aria-label="Loading connector"
      aria-busy="true"
    >
      <div className="h-14 w-14 rounded-[14px] bg-zGray-850" />
      <div className="mt-5 h-6 w-32 rounded-md bg-zGray-850" />
      <div className="mt-2.5 h-3.5 w-80 max-w-full rounded bg-zGray-850/80" />

      <div className="mt-10 flex items-center justify-between border-b border-zGray-800/55 pb-2.5">
        <div className="h-4 w-24 rounded bg-zGray-850" />
        <div className="h-3 w-16 rounded bg-zGray-850/80" />
      </div>
      <div className="mt-3 space-y-2">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="flex items-center gap-3 rounded-xl border border-zGray-800/35 px-3 py-3.5"
          >
            <div className="h-9 w-9 flex-none rounded-[10px] bg-zGray-850" />
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-36 rounded bg-zGray-850" />
              <div className="mt-2 h-3 w-24 rounded bg-zGray-850/70" />
            </div>
            <div className="h-7 w-20 rounded-full bg-zGray-850/80" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Shared connector-info page. Fetches its own binding by id so a deep-linked
 * /connectors/<provider>/<id> URL restores without any tab-local state.
 */
export function ConnectorInfoView({
  teamId,
  currentUserId,
  provider,
  connectorId,
  refreshKey,
  onNameResolved,
  inAppActionsForConnection,
  disconnectActionForConnection,
  onConnectionsChanged,
  onOpenAgentChat,
  onOpenSettingsSection,
}: {
  teamId: string
  currentUserId: string
  provider: ConnectorInfoProvider
  connectorId: string
  refreshKey: number
  /** Reports the connector's display name so the breadcrumb/tab can refine a
   *  URL-restored placeholder label. */
  onNameResolved?: (name: string) => void
  /** Optional jump to the connector's dedicated in-app page (devices, monitors,
   *  dashboards, …) when one exists. */
  inAppActionsForConnection: (connectorId: string) => ConnectorInfoAction[]
  /** Returns the provider's existing unbind action for this connection. */
  disconnectActionForConnection: (connectorId: string) => (() => Promise<void>) | undefined
  onConnectionsChanged: () => void
  /** Prefill a fresh Agent conversation so the user can review or adjust the task. */
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
  onOpenSettingsSection: (section: string) => void
}) {
  const bindFlowRef = useRef<TeamHomeBindFlowHandle>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [connections, setConnections] = useState<LoadedConnectorInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(
    connectorId === 'all' ? null : connectorId,
  )
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [disconnectTarget, setDisconnectTarget] = useState<DisconnectTarget | null>(null)

  useResetOnKey(
    `${teamId}|${provider}|${connectorId}|${String(refreshKey)}|${String(reloadKey)}`,
    () => setState('loading'),
  )
  useEffect(() => {
    let cancelled = false

    loadConnectorInfos(teamId, provider)
      .then((next) => {
        if (cancelled) return
        setConnections(next)
        setState(next.length > 0 ? 'ready' : 'missing')
        setSelectedId((current) => {
          if (current && next.some((connection) => connection.id === current)) return current
          if (connectorId !== 'all' && next.some((connection) => connection.id === connectorId)) {
            return connectorId
          }
          if (next.length === 1) return next[0].id

          return null
        })
        if (next.length > 0) onNameResolved?.(CONNECTOR_INFO_LABELS[provider])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState('missing')
        toast.apiError('Could not load connector', e)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, provider, connectorId, refreshKey, reloadKey])

  const providerLabel = CONNECTOR_INFO_LABELS[provider]
  const addAction = installedConnectorAddAction(provider)
  const onBindingsChanged = () => {
    setReloadKey((key) => key + 1)
    onConnectionsChanged()
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin selectable">
      {state !== 'ready' && (
        <>
          {state === 'loading' && <ConnectorInfoSkeleton />}
          {state === 'missing' && (
            <div className="mx-auto w-full max-w-[760px] px-7 py-10">
              <div className="text-[12.5px] text-tertiary">
                No connections were found for this connector.
              </div>
            </div>
          )}
        </>
      )}
      {state === 'ready' && connections.length > 0 && (
        <ConnectorInfoPage
          provider={provider}
          providerLabel={providerLabel}
          connections={connections.map((connection) => ({
            ...connection,
            inAppActions: inAppActionsForConnection(connection.id),
            canDisconnect: Boolean(disconnectActionForConnection(connection.id)),
            details:
              connection.id === selectedId && hasConnectorManagement(provider) ? (
                <ConnectorManagementSection
                  teamId={teamId}
                  currentUserId={currentUserId}
                  provider={provider}
                  connectorId={connection.id}
                  info={connection.info}
                  refreshKey={refreshKey + reloadKey}
                  onOpenAgentChat={onOpenAgentChat}
                  onChanged={onBindingsChanged}
                />
              ) : undefined,
          }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          addAction={
            addAction
              ? {
                  label: addAction.mode === 'install' ? 'Add connection' : addAction.label,
                  onClick: () => bindFlowRef.current?.openIntegration(provider, addAction.mode),
                }
              : undefined
          }
          onDisconnect={(id, name) => {
            const action = disconnectActionForConnection(id)

            if (action) setDisconnectTarget({ id, name, action })
          }}
        />
      )}
      <TeamHomeBindFlow
        ref={bindFlowRef}
        teamId={teamId}
        onOpenAgentChat={(prompt) => onOpenAgentChat(prompt)}
        onOpenSettingsSection={onOpenSettingsSection}
        onChanged={onBindingsChanged}
        onFocusConnector={(detail) => {
          if (detail.provider === provider) setSelectedId(detail.connectorId)
        }}
      />
      {disconnectTarget && (
        <DisconnectConnectorDialog
          target={disconnectTarget}
          onClose={() => setDisconnectTarget(null)}
          onDisconnected={(id) => {
            const remaining = connections.filter((connection) => connection.id !== id)

            setConnections(remaining)
            setSelectedId(remaining.length === 1 ? remaining[0].id : null)
            setState(remaining.length > 0 ? 'ready' : 'missing')
            setDisconnectTarget(null)
            onConnectionsChanged()
          }}
        />
      )}
    </div>
  )
}
