import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { BindingAccessSection } from '../../components/BindingAccess'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { formatAge } from '../../utils'
import { useResetOnKey } from '../useResetOnKey'

import { ResizableDetailPane } from './detailPane'
import { BindAnotherIdentity, RetiredBindingBadge } from './shared'

import type { AzureAccount, AzureRoleAssignment } from '../../types'

// Apps bound under one Azure subscription — the analog of AwsRolesView (roles
// under an account). Clicking an app opens a detail pane listing its RBAC role
// assignments (the "what can this app do" view). The human-only permission-admin
// binding is badged.
export function AzureAppsView({
  teamId,
  onOpenAgentChat,
  apps,
  filter,
  onCount,
  onChanged,
}: {
  teamId: string
  onOpenAgentChat: (prompt: string) => void
  apps: AzureAccount[]
  filter: string
  onCount: (n: number) => void
  onChanged: () => void
}) {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const normalized = filter.trim().toLowerCase()
  const rows = normalized
    ? apps.filter((app) =>
        `${app.label} ${app.clientId} ${app.subscriptionId}`.toLowerCase().includes(normalized),
      )
    : apps

  useEffect(() => {
    onCount(rows.length)
  }, [rows.length, onCount])

  // Drop a stale selection if the app was unbound between refreshes.
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null

  return (
    <div className="flex-1 flex min-h-0">
      <BindAnotherIdentity
        onOpenAgentChat={onOpenAgentChat}
        provider="azure"
        teamId={teamId}
        onBound={onChanged}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {apps.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary">
            No apps available for this subscription.
          </div>
        ) : (
          <Table<AzureAccount>
            rows={rows}
            rowKey={(app) => app.id}
            onPrimaryAction={(app) => setSelectedAppId(app.id)}
            empty="No matching apps."
            storageKey="azure-apps"
            columns={[
              {
                key: 'app',
                header: 'App',
                width: 360,
                sortAccessor: (app) => app.label,
                render: (app) => (
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={clsx(
                          'truncate',
                          app.id === selectedApp?.id
                            ? 'text-main font-medium'
                            : 'text-zViolet-accent',
                        )}
                      >
                        {app.label}
                      </span>
                      {app.purpose === 'permission-admin' && <RetiredBindingBadge />}
                    </div>
                    <div className="text-[11.5px] text-tertiary truncate font-mono">
                      {app.clientId}
                    </div>
                  </div>
                ),
              },
              {
                key: 'age',
                header: 'Age',
                width: 110,
                sortAccessor: (app) => app.createdAt ?? '',
                render: (app) => (
                  <span className="text-tertiary">
                    {app.createdAt ? `${formatAge(app.createdAt)} ago` : '—'}
                  </span>
                ),
              },
            ]}
          />
        )}
      </div>
      {selectedApp && (
        <ResizableDetailPane onClose={() => setSelectedAppId(null)}>
          {(requestClose) => (
            <AzureAppPermissionsView
              teamId={teamId}
              accountId={selectedApp.id}
              app={selectedApp}
              onClose={requestClose}
            />
          )}
        </ResizableDetailPane>
      )}
    </div>
  )
}

// Detail pane for one Azure app binding — its RBAC role assignments on the
// subscription (analog of AwsIamPermissionsView's attached policies).
function AzureAppPermissionsView({
  teamId,
  accountId,
  app,
  onClose,
}: {
  teamId: string
  accountId: string
  app: AzureAccount
  onClose: () => void
}) {
  const [assignments, setAssignments] = useState<AzureRoleAssignment[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useResetOnKey(`${teamId}|${accountId}`, () => setState('loading'))

  useEffect(() => {
    let cancelled = false

    api
      .atlasListAzureRoleAssignments(teamId, accountId)
      .then((rows) => {
        if (cancelled) return
        setAssignments(rows)
        setState('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState('error')
        toast.apiError('Could not load Azure role assignments', e)
      })

    return () => {
      cancelled = true
    }
  }, [teamId, accountId])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-zGray-800">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] text-main font-medium truncate">{app.label}</span>
            {app.purpose === 'permission-admin' && <RetiredBindingBadge />}
          </div>
          <div className="text-[11.5px] text-tertiary truncate font-mono">{app.clientId}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-tertiary hover:text-main hover:bg-zGray-800"
          title="Close"
        >
          <X className="w-4 h-4" strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-tertiary font-medium mb-2">
            Role assignments
          </div>
          {state === 'loading' ? (
            <div className="text-[12.5px] text-tertiary">Loading…</div>
          ) : state === 'error' ? (
            <div className="text-[12.5px] text-tertiary">
              Couldn’t load role assignments. Close and reopen to retry.
            </div>
          ) : state === 'ready' && (assignments?.length ?? 0) === 0 ? (
            <div className="text-[12.5px] text-tertiary">
              This app has no role assignments on the subscription. Grant it a role in the Azure
              portal (Access control → Add role assignment).
            </div>
          ) : state === 'ready' ? (
            <div className="space-y-1.5">
              {assignments!.map((assignment, i) => (
                <div
                  key={`${assignment.roleDefinitionId}:${assignment.scope}:${String(i)}`}
                  className="px-3 py-2 rounded-md border border-zGray-800 bg-zGray-850"
                >
                  <div className="text-[12.5px] text-main font-medium">{assignment.roleName}</div>
                  <div
                    className="text-[11px] text-tertiary truncate font-mono"
                    title={assignment.scope}
                  >
                    {assignment.scope}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {/* Which team members may use this app (member allow-list) — the AWS/GCP
            parity: admins gate it, and an agent can only use it when the member
            both has access here and selects it for the session. */}
        <BindingAccessSection
          teamId={teamId}
          provider="azure"
          resourceId={accountId}
          principal={app.clientId}
          refreshKey={0}
        />
      </div>
    </div>
  )
}
