import type { TeamInvitation, TeamMember, TeamRole } from '../../types'

export function roleLabel(role: TeamRole): string {
  switch (role) {
    case 'ADMINISTRATOR':
      return 'Admin'
    case 'EDITOR':
      return 'Editor'
    case 'VIEWER':
      return 'Viewer'
  }
}

export function roleClass(role: TeamRole): string {
  switch (role) {
    case 'ADMINISTRATOR':
      return 'border-zViolet-500/45 bg-zViolet-500/12 text-zViolet-accent'
    case 'EDITOR':
      return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
    case 'VIEWER':
      return 'border-zGray-700 bg-zGray-800/70 text-secondary'
  }
}

export function formatDate(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return 'Unknown'

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export type MemberRow =
  { kind: 'member'; member: TeamMember } | { kind: 'invitation'; invitation: TeamInvitation }

export function rowName(row: MemberRow): string {
  return row.kind === 'member' ? row.member.name || row.member.email : row.invitation.inviteeEmail
}

export function rowEmail(row: MemberRow): string {
  return row.kind === 'member' ? row.member.email : row.invitation.inviteeEmail
}

export function rowDate(row: MemberRow): string {
  return row.kind === 'member' ? row.member.joinedAt : row.invitation.invitedAt
}

export function applyFilter(rows: MemberRow[], filter: string): MemberRow[] {
  const normalized = filter.trim().toLowerCase()

  if (!normalized) return rows

  return rows.filter((row) =>
    (row.kind === 'member'
      ? [row.member.name, row.member.email, row.member.username, roleLabel(row.member.role)]
      : [row.invitation.inviteeEmail, 'invited', 'pending']
    )
      .join(' ')
      .toLowerCase()
      .includes(normalized),
  )
}
