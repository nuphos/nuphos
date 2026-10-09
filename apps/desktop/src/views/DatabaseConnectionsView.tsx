import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { isDatabaseEngineReleased } from '../lib/databaseRelease'

import { ConnectionAccessSection } from './database-connection/ConnectionAccessSection'
import { ErrorBlock, Loading } from './database-connection/ConnectionBits'
import {
  ChangesSection,
  CollectionsSection,
  MonitoringSection,
  QuerySection,
} from './database-connection/ConnectionEngineSections'
import { ConnectionHeader, OverviewSection } from './database-connection/ConnectionOverview'
import {
  ConnectionSettingsSection,
  RemoveConnectionModal,
} from './database-connection/ConnectionSettings'
import { DatabaseQueryAuditPanel } from './DatabaseQueryAuditPanel'
import { useResetOnKey } from './useResetOnKey'

import type { DatabaseAgentPolicy, DatabaseConnection, TeamMember } from '../types'

type Props = {
  teamId: string
  currentUserId: string
  connectionId: string
  /** Sidebar nav key for this scope, e.g. `database.overview`. */
  active: string
  refreshKey: number
  isTeamAdmin: boolean
  onChanged: () => void
  /** Leave the connection scope — used when it is removed or not released. */
  onLeave: () => void
  onOpenPlanInChat?: (planId: string) => void
}

export function DatabaseConnectionsView(props: Props) {
  return <DatabaseDetail {...props} />
}

function DatabaseDetail({
  teamId,
  currentUserId,
  connectionId,
  active,
  refreshKey,
  isTeamAdmin,
  onChanged,
  onLeave,
  onOpenPlanInChat,
}: Props) {
  const [connection, setConnection] = useState<DatabaseConnection | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  // The query console keeps its editors and results while you visit other
  // sections, so it is mounted on first visit and then only hidden.
  const [queryMounted, setQueryMounted] = useState(active === 'database.query')

  useResetOnKey(active, () => {
    if (active === 'database.query') setQueryMounted(true)
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeName, setRemoveName] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const fetchConnection = useCallback(
    () =>
      api
        .atlasGetDatabaseConnection(teamId, connectionId)
        .then((next) => {
          if (!isDatabaseEngineReleased(next.engine)) {
            onLeave()

            return
          }
          setConnection(next)
        })
        .catch((cause: unknown) => {
          setError(parseAtlasError(cause).message)
        }),
    [teamId, connectionId, onLeave],
  )
  // Retry buttons clear the previous error themselves; the load below clears it
  // from the render that changes the connection instead.
  const load = useCallback(async () => {
    setError(null)
    await fetchConnection()
  }, [fetchConnection])

  useResetOnKey(`${teamId}|${connectionId}|${String(refreshKey)}`, () => setError(null))
  useEffect(() => {
    void fetchConnection()
  }, [fetchConnection, refreshKey])
  useResetOnKey(connectionId, () => setQueryMounted(false))
  useEffect(() => {
    void api
      .atlasListTeamMembers(teamId)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [teamId])
  const checked = useMemo(
    () => (connection ? new Date(connection.health.checkedAt).toLocaleString() : ''),
    [connection],
  )

  async function testStored() {
    setBusy(true)
    setError(null)
    try {
      setConnection(await api.atlasTestStoredDatabaseConnection(teamId, connectionId))
      onChanged()
    } catch (cause) {
      setError(parseAtlasError(cause).message)
    } finally {
      setBusy(false)
    }
  }
  async function updateAccess(memberAllowList: string[], policy: DatabaseAgentPolicy) {
    if (!connection?.access) return
    setBusy(true)
    setError(null)
    try {
      setConnection(
        await api.atlasUpdateDatabaseConnection(teamId, connectionId, {
          access: { memberAllowList, agentPolicy: policy },
        }),
      )
      onChanged()
    } catch (cause) {
      setError(parseAtlasError(cause).message)
    } finally {
      setBusy(false)
    }
  }
  async function updatePolicy(policy: DatabaseAgentPolicy) {
    if (!connection?.access) return
    await updateAccess(connection.access.memberAllowList, policy)
  }
  async function updateMemberAccess(memberAllowList: string[]) {
    await updateAccess(memberAllowList, connection?.agentPolicy ?? 'disabled')
  }
  async function remove() {
    if (removeName !== connection?.name) return
    setBusy(true)
    setError(null)
    try {
      await api.atlasDeleteDatabaseConnection(teamId, connectionId)
      setRemoveOpen(false)
      setRemoveName('')
      onChanged()
      onLeave()
    } catch (cause) {
      setError(parseAtlasError(cause).message)
      setBusy(false)
    }
  }

  if (!connection && !error) return <Loading />
  if (!connection)
    return (
      <div className="p-7">
        <ErrorBlock message={error ?? 'Database not found'} onRetry={load} />
      </div>
    )

  return (
    <div className="w-full">
      <ConnectionHeader
        connection={connection}
        busy={busy}
        isTeamAdmin={isTeamAdmin}
        onTest={() => void testStored()}
      />
      {error && (
        <div className="mt-4">
          <ErrorBlock message={error} onRetry={load} />
        </div>
      )}
      <div>
        {active === 'database.overview' && (
          <OverviewSection connection={connection} checked={checked} />
        )}
        {active === 'database.collections' && (
          <CollectionsSection teamId={teamId} connection={connection} />
        )}
        {queryMounted && (
          <QuerySection
            teamId={teamId}
            connection={connection}
            visible={active === 'database.query'}
          />
        )}
        {active === 'database.changes' && (
          <ChangesSection
            teamId={teamId}
            currentUserId={currentUserId}
            connection={connection}
            members={members}
            onOpenPlanInChat={onOpenPlanInChat}
          />
        )}
        {active === 'database.monitoring' && (
          <MonitoringSection teamId={teamId} connection={connection} />
        )}
        {active === 'database.access' && (
          <ConnectionAccessSection
            connection={connection}
            members={members}
            currentUserId={currentUserId}
            isTeamAdmin={isTeamAdmin}
            busy={busy}
            onUpdateMemberAccess={(memberAllowList) => void updateMemberAccess(memberAllowList)}
            onUpdatePolicy={(policy) => void updatePolicy(policy)}
          />
        )}
        {active === 'database.audit' && (
          <div className="border-t border-zGray-800/60 px-6 py-4">
            <DatabaseQueryAuditPanel teamId={teamId} connectionId={connection.id} />
          </div>
        )}
        {active === 'database.settings' && (
          <ConnectionSettingsSection
            connection={connection}
            busy={busy}
            isTeamAdmin={isTeamAdmin}
            onRemoveOpen={() => {
              setRemoveName('')
              setRemoveOpen(true)
            }}
          />
        )}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title="Remove database from Nuphos?"
        description={`Remove “${connection.name}” and its ${connection.providerOrigin ? 'provider binding reference' : 'encrypted credential'} and resource metadata? This does not delete or modify the database itself.`}
        confirmLabel="Remove from Nuphos"
        destructive
        onConfirm={remove}
        onClose={() => setConfirmRemove(false)}
      />
      <RemoveConnectionModal
        connection={connection}
        open={removeOpen}
        busy={busy}
        removeName={removeName}
        onRemoveNameChange={setRemoveName}
        onClose={() => {
          setRemoveOpen(false)
          setRemoveName('')
        }}
        onRemove={() => {
          setRemoveOpen(false)
          setConfirmRemove(true)
        }}
      />
    </div>
  )
}
