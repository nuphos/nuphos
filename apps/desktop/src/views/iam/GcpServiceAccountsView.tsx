import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { ContextMenu } from '../../components/ContextMenu'
import { Table } from '../../components/Table'
import { useTeamMembers } from '../../lib/bindingAccess'
import { formatAge } from '../../utils'

import { AccessMembersAvatarGroup } from './AccessMembersAvatarGroup'
import { accessSortValue } from './common'
import { ResizableDetailPane } from './detailPane'
import { GcpIamPermissionsView } from './GcpIamPermissionsView'
import { BindAnotherIdentity, BindingWarningIndicator, RetiredBindingBadge } from './shared'

import type { ContextMenuItem } from '../../components/ContextMenu'
import type { BindingAccess, GcpProject } from '../../types'

export function GcpServiceAccountsView({
  teamId,
  onOpenAgentChat,
  projectId,
  serviceAccounts,
  filter,
  selectedServiceAccountId,
  refreshKey,
  onLoading,
  onCount,
  onPick,
  onAccessChanged,
  onUnbound,
  onCloseDetail,
}: {
  teamId: string
  onOpenAgentChat: (prompt: string) => void
  projectId: string
  serviceAccounts: GcpProject[]
  filter: string
  selectedServiceAccountId?: string
  refreshKey: number
  onLoading?: (loading: boolean) => void
  onCount: (n: number) => void
  onPick: (serviceAccount: GcpProject) => void
  onAccessChanged: () => void
  onUnbound: () => void
  onCloseDetail: () => void
}) {
  const members = useTeamMembers(teamId)
  const [accessOverrides, setAccessOverrides] = useState<Record<string, BindingAccess>>({})
  const [menu, setMenu] = useState<{ serviceAccount: GcpProject; x: number; y: number } | null>(
    null,
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const normalized = filter.trim().toLowerCase()
  const rows = normalized
    ? serviceAccounts.filter((serviceAccount) =>
        `${serviceAccount.serviceAccountEmail} ${serviceAccount.projectId} ${serviceAccount.alias ?? ''}`
          .toLowerCase()
          .includes(normalized),
      )
    : serviceAccounts

  useEffect(() => {
    onCount(rows.length)
  }, [rows.length, onCount])

  const selectedServiceAccount = serviceAccounts.find(
    (serviceAccount) => serviceAccount.serviceAccountId === selectedServiceAccountId,
  )
  const accessForServiceAccount = useCallback(
    (serviceAccount: GcpProject) =>
      accessOverrides[serviceAccount.serviceAccountId] ?? serviceAccount.access,
    [accessOverrides],
  )
  const handleAccessChanged = useCallback(
    (serviceAccountId: string, access: BindingAccess) => {
      setAccessOverrides((prev) => ({ ...prev, [serviceAccountId]: access }))
      onAccessChanged()
    },
    [onAccessChanged],
  )

  const menuItems = (serviceAccount: GcpProject): ContextMenuItem[] => [
    {
      key: 'unbind',
      label: 'Unbind',
      icon: Trash2,
      destructive: true,
      confirm: `Unbind ${serviceAccount.serviceAccountEmail} from ${serviceAccount.projectId}?`,
      onSelect: async () => {
        setActionError(null)
        try {
          await api.atlasUnbindGcpProject(
            teamId,
            serviceAccount.projectId,
            serviceAccount.serviceAccountId,
          )
          onUnbound()
          if (serviceAccount.serviceAccountId === selectedServiceAccountId) {
            onCloseDetail()
          }
        } catch (e) {
          setActionError(parseAtlasError(e).message)
        }
      },
    },
  ]

  return (
    <div className="flex-1 flex min-h-0">
      <BindAnotherIdentity
        onOpenAgentChat={onOpenAgentChat}
        provider="gcp"
        teamId={teamId}
        onBound={onAccessChanged}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {actionError && (
          <div className="mx-4 mb-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
            {actionError}
          </div>
        )}
        {serviceAccounts.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary">
            No service accounts available for this project.
          </div>
        ) : (
          <Table<GcpProject>
            rows={rows}
            rowKey={(serviceAccount) => serviceAccount.serviceAccountId}
            onPrimaryAction={onPick}
            onRowContextMenu={(serviceAccount, e) => {
              setActionError(null)
              setMenu({ serviceAccount, x: e.clientX, y: e.clientY })
            }}
            empty="No matching service accounts."
            storageKey="gcp-service-accounts"
            columns={[
              {
                key: 'service-account',
                header: 'Service Account',
                width: 420,
                sortAccessor: (serviceAccount) => serviceAccount.serviceAccountEmail,
                render: (serviceAccount) => (
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={clsx(
                          'truncate',
                          serviceAccount.serviceAccountId ===
                            selectedServiceAccount?.serviceAccountId
                            ? 'text-main font-medium'
                            : 'text-zViolet-accent',
                        )}
                      >
                        {serviceAccount.serviceAccountEmail}
                      </span>
                      {serviceAccount.purpose === 'permission-admin' && <RetiredBindingBadge />}
                      <BindingWarningIndicator warnings={serviceAccount.warnings} />
                    </div>
                    {serviceAccount.alias && (
                      <div className="text-[11.5px] text-tertiary truncate">
                        {serviceAccount.alias}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'access',
                header: 'Access',
                width: 110,
                sortAccessor: (serviceAccount) => serviceAccount.canUse !== false,
                render: (serviceAccount) => (
                  <span
                    className={clsx(
                      'text-[11px] font-medium px-1.5 py-0.5 rounded',
                      serviceAccount.canUse === false
                        ? 'bg-error/15 text-error'
                        : 'bg-success/15 text-success',
                    )}
                  >
                    {serviceAccount.canUse === false ? 'Denied' : 'Allowed'}
                  </span>
                ),
              },
              {
                key: 'age',
                header: 'Age',
                width: 110,
                sortAccessor: (serviceAccount) => serviceAccount.createdAt ?? '',
                render: (serviceAccount) => (
                  <span className="text-tertiary">
                    {serviceAccount.createdAt ? `${formatAge(serviceAccount.createdAt)} ago` : '—'}
                  </span>
                ),
              },
              {
                key: 'members',
                header: '',
                width: 220,
                sortAccessor: (serviceAccount) =>
                  accessSortValue(
                    accessForServiceAccount(serviceAccount)?.memberAllowList,
                    members,
                  ),
                render: (serviceAccount) => (
                  <AccessMembersAvatarGroup
                    allowList={accessForServiceAccount(serviceAccount)?.memberAllowList}
                    members={members}
                    resourceLabel="service account"
                  />
                ),
              },
            ]}
          />
        )}
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems(menu.serviceAccount)}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
      {selectedServiceAccount && (
        <ResizableDetailPane onClose={onCloseDetail}>
          {(requestClose) => (
            <GcpIamPermissionsView
              teamId={teamId}
              projectId={projectId}
              serviceAccountId={selectedServiceAccount.serviceAccountId}
              refreshKey={refreshKey}
              isRetiredBinding={selectedServiceAccount.purpose === 'permission-admin'}
              onLoading={onLoading}
              onAccessChanged={(access) =>
                handleAccessChanged(selectedServiceAccount.serviceAccountId, access)
              }
              onClose={requestClose}
            />
          )}
        </ResizableDetailPane>
      )}
    </div>
  )
}
