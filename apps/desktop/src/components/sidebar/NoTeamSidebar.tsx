import { SidebarFooter } from './SidebarFooter'
import { SidebarTeamSwitcher } from './header'
import { storedSidebarWidth } from './state'

import type { SidebarProps } from './types'

type Props = Pick<
  SidebarProps,
  | 'user'
  | 'onLogout'
  | 'onCreateTeam'
  | 'pendingInvitations'
  | 'onAcceptInvitation'
  | 'onRejectInvitation'
> & { loading: boolean }

/**
 * The sidebar before any team is open: teams loading, the backend unreachable,
 * or only invitations. It has the account, the invitations and help, and
 * nothing of a team, so no team-scoped request can start without one.
 */
export function NoTeamSidebar({ loading, onCreateTeam, ...footer }: Props) {
  return (
    <aside
      style={{ width: storedSidebarWidth() }}
      className="sidebar-surface flex flex-shrink-0 flex-col"
    >
      <div className="titlebar-drag desk-titlebar-row flex-shrink-0" />
      <SidebarTeamSwitcher loading={loading} onCreateTeam={onCreateTeam} />
      <div className="flex-1" />
      <SidebarFooter connectorsOpen={false} onSelect={() => {}} {...footer} />
    </aside>
  )
}
