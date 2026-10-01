import clsx from 'clsx'
import { Mail, ShieldCheck } from 'lucide-react'

import { Avatar } from '../../components/Avatar'

import { formatDate, roleClass, roleLabel, rowDate, rowEmail, rowName } from './memberRows'

import type { MemberRow } from './memberRows'
import type { Column } from '../../components/Table'

// The trailing "⋯" column is appended by `Table` itself whenever the view
// passes `onRowContextMenu` — which this one gates on `canManageMembers`.
export function buildMemberColumns(): Column<MemberRow>[] {
  return [
    {
      key: 'name',
      header: 'Member',
      width: 280,
      sortAccessor: rowName,
      render: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          {row.kind === 'member' ? (
            <Avatar
              src={row.member.avatarURL}
              name={row.member.name || row.member.email}
              size={28}
              className="rounded-md !shadow-none"
            />
          ) : (
            <div className="w-7 h-7 rounded-md border border-dashed border-zGray-700 bg-zGray-850 flex items-center justify-center text-tertiary">
              <Mail className="w-3.5 h-3.5" strokeWidth={1.8} />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-main font-medium truncate">{rowName(row)}</div>
            <div className="text-[12px] text-tertiary truncate">
              {row.kind === 'member' ? `@${row.member.username}` : 'Invited'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      width: 260,
      sortAccessor: rowEmail,
      render: (row) => (
        <span className="font-mono text-[12px] text-secondary">{rowEmail(row)}</span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: 150,
      sortAccessor: (row) => (row.kind === 'member' ? row.member.role : 'INVITED'),
      render: (row) =>
        row.kind === 'member' ? (
          <span
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium',
              roleClass(row.member.role),
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.8} />
            {roleLabel(row.member.role)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[12px] font-medium text-warning">
            <Mail className="w-3.5 h-3.5" strokeWidth={1.8} />
            Invited
          </span>
        ),
    },
    {
      key: 'joinedAt',
      header: 'Joined',
      width: 160,
      sortAccessor: rowDate,
      render: (row) => <span className="text-secondary">{formatDate(rowDate(row))}</span>,
    },
  ]
}
