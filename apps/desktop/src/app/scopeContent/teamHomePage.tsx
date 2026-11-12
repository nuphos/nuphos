import { ChartNoAxesColumn } from 'lucide-react'

import { NuphosDashboardsView } from '../../dashboards/NuphosDashboardsView'
import { t } from '../../i18n'
import { TeamHomeView } from '../../views/TeamHomeView'

import type { ScopeRenderContext } from './context'

export function renderTeamHomePage(ctx: ScopeRenderContext) {
  return ctx.renderPage(
    'team.home',
    t('Stats'),
    <ChartNoAxesColumn className="size-3.5 text-tertiary" strokeWidth={1.8} />,
    <TeamHomeView
      customBoardOpen={Boolean(ctx.nuphosDashboard)}
      customBoards={
        <NuphosDashboardsView
          embedded
          teamId={ctx.scope.teamId}
          refreshKey={ctx.refreshKey}
          filter=""
          onCount={ctx.onCount}
          onLoading={ctx.onLoading}
          onOpenAgentChat={ctx.onOpenAgentChat}
          openDashboardId={ctx.nuphosDashboard?.dashboardId ?? null}
          viewRange={ctx.nuphosDashboard?.viewRange}
          onDashboardOpened={ctx.setNuphosDashboard}
          onDashboardsChange={ctx.setNuphosDashboards}
        />
      }
      teamId={ctx.scope.teamId}
      refreshKey={ctx.refreshKey}
      isTeamAdmin={ctx.isTeamAdmin}
      onOpenConversation={ctx.onOpenConversation}
      onOpenLink={ctx.onOpenNodeLink}
    />,
  )
}
