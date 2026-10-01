import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'

import { Table } from '../../components/Table'
import { useTeamMembers } from '../../lib/bindingAccess'
import { formatAge } from '../../utils'

import { AccessMembersAvatarGroup } from './AccessMembersAvatarGroup'
import { AwsIamPermissionsView } from './AwsIamPermissionsView'
import { accessSortValue, awsRoleName } from './common'
import { ResizableDetailPane } from './detailPane'
import { BindAnotherIdentity, RetiredBindingBadge } from './shared'

import type { AwsAccount, BindingAccess } from '../../types'

export function AwsRolesView({
  teamId,
  accountId,
  roles,
  filter,
  selectedRoleId,
  refreshKey,
  onLoading,
  onCount,
  onPick,
  onAccessChanged,
  onCloseDetail,
  onOpenAgentChat,
}: {
  teamId: string
  accountId: string
  roles: AwsAccount[]
  filter: string
  selectedRoleId?: string
  refreshKey: number
  onLoading?: (loading: boolean) => void
  onCount: (n: number) => void
  onPick: (role: AwsAccount) => void
  onAccessChanged: () => void
  onCloseDetail: () => void
  onOpenAgentChat?: (prompt: string) => void
}) {
  const members = useTeamMembers(teamId)
  const [accessOverrides, setAccessOverrides] = useState<Record<string, BindingAccess>>({})
  const normalized = filter.trim().toLowerCase()
  const rows = normalized
    ? roles.filter((role) =>
        `${role.roleArn} ${role.accountId} ${role.alias ?? ''}`.toLowerCase().includes(normalized),
      )
    : roles

  useEffect(() => {
    onCount(rows.length)
  }, [rows.length, onCount])

  const selectedRole =
    roles.find((role) => role.roleId === selectedRoleId) ??
    roles.find((role) => role.roleArn === selectedRoleId)
  const accessForRole = useCallback(
    (role: AwsAccount) => accessOverrides[role.roleId] ?? role.access,
    [accessOverrides],
  )
  const handleAccessChanged = useCallback(
    (roleId: string, access: BindingAccess) => {
      setAccessOverrides((prev) => ({ ...prev, [roleId]: access }))
      onAccessChanged()
    },
    [onAccessChanged],
  )

  return (
    <div className="flex-1 flex min-h-0">
      <BindAnotherIdentity
        provider="aws"
        teamId={teamId}
        onBound={onAccessChanged}
        onOpenAgentChat={onOpenAgentChat}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {roles.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary">
            No roles available for this account.
          </div>
        ) : (
          <Table<AwsAccount>
            rows={rows}
            rowKey={(role) => role.roleId}
            onPrimaryAction={onPick}
            empty="No matching roles."
            storageKey="aws-roles"
            columns={[
              {
                key: 'role',
                header: 'Role',
                width: 320,
                sortAccessor: (role) => awsRoleName(role.roleArn),
                render: (role) => (
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={clsx(
                          'truncate',
                          role.roleId === selectedRole?.roleId
                            ? 'text-main font-medium'
                            : 'text-zViolet-accent',
                        )}
                      >
                        {awsRoleName(role.roleArn)}
                      </span>
                      {role.purpose === 'permission-admin' && <RetiredBindingBadge />}
                    </div>
                    {role.alias && (
                      <div className="text-[11.5px] text-tertiary truncate">{role.alias}</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'access',
                header: 'Access',
                width: 110,
                sortAccessor: (role) => role.canUse !== false,
                render: (role) => (
                  <span
                    className={clsx(
                      'text-[11px] font-medium px-1.5 py-0.5 rounded',
                      role.canUse === false
                        ? 'bg-error/15 text-error'
                        : 'bg-success/15 text-success',
                    )}
                  >
                    {role.canUse === false ? 'Denied' : 'Allowed'}
                  </span>
                ),
              },
              {
                key: 'age',
                header: 'Age',
                width: 110,
                sortAccessor: (role) => role.createdAt ?? '',
                render: (role) => (
                  <span className="text-tertiary">
                    {role.createdAt ? `${formatAge(role.createdAt)} ago` : '—'}
                  </span>
                ),
              },
              {
                key: 'members',
                header: '',
                width: 220,
                sortAccessor: (role) =>
                  accessSortValue(accessForRole(role)?.memberAllowList, members),
                render: (role) => (
                  <AccessMembersAvatarGroup
                    allowList={accessForRole(role)?.memberAllowList}
                    members={members}
                    resourceLabel="role"
                  />
                ),
              },
            ]}
          />
        )}
      </div>
      {selectedRole && (
        <ResizableDetailPane onClose={onCloseDetail}>
          {(requestClose) => (
            <AwsIamPermissionsView
              teamId={teamId}
              accountId={accountId}
              roleId={selectedRole.roleId}
              roleArn={selectedRole.roleArn}
              refreshKey={refreshKey}
              isRetiredBinding={selectedRole.purpose === 'permission-admin'}
              onLoading={onLoading}
              onAccessChanged={(access) => handleAccessChanged(selectedRole.roleId, access)}
              onClose={requestClose}
            />
          )}
        </ResizableDetailPane>
      )}
    </div>
  )
}
