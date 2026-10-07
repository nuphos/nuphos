import {
  Archive,
  Bot,
  Brain,
  ChartLine,
  ClipboardList,
  Clock,
  HeartPulse,
  Network,
  ScrollText,
  Sparkles,
  Users,
} from 'lucide-react'

import { NuphosDashboardsView } from '../../dashboards/NuphosDashboardsView'
import { dashboardsPageTitle } from '../../dashboards/view/pageTitle'
import { AgentSection } from '../../views/settings/AgentSection'
import { AgentMemoriesView } from '../../views/AgentMemoriesView'
import { ArchitectureView } from '../../views/ArchitectureView'
import { ArchivedChatsView } from '../../views/ArchivedChatsView'
import { AuditLogView } from '../../views/AuditLogView'
import { BrowserView } from '../../views/BrowserView'
import { TerminalView } from '../../views/TerminalView'
import { MonitoringView } from '../../views/MonitoringView'
import { PlansView } from '../../views/PlansView'
import { RuntimeFilesView } from '../../views/RuntimeFilesView'
import { TeamMembersView } from '../../views/TeamMembersView'
import { TeamSkillsView } from '../../views/TeamSkillsView'
import { TriggersView } from '../../views/TriggersView'

import type { ScopeRenderContext } from './context'

// Browser owns its dynamic page metadata; other pages use the shared wrapper.
// eslint-disable-next-line sonarjs/function-return-type
export function renderTeamToolPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    currentUserId,
    filter,
    refreshKey,
    architectureDetail,
    setArchitectureDetail,
    triggerDetail,
    setTriggerDetail,
    triggerForm,
    setTriggerForm,
    nuphosDashboard,
    nuphosDashboards,
    restoredTitle,
    setNuphosDashboard,
    setNuphosDashboards,
    onCount,
    onLoading,
    onOpenAgentChat,
    onOpenPlanInChat,
    isTeamAdmin,
    onOpenAuditConversation,
    onOpenConversation,
    onOpenNodeLink,
    onSelectActive,
    renderPage,
  } = ctx

  if (scope.kind !== 'team') return undefined

  if (active === 'team.agents') {
    return renderPage(
      'team.agents',
      'Agents',
      <Bot className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <AgentSection
        key={scope.teamId}
        teamId={scope.teamId}
        isAdmin={isTeamAdmin}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (active === 'team.files') return <RuntimeFilesView teamId={scope.teamId} />

  if (active === 'team.terminal') return <TerminalView teamId={scope.teamId} filter={filter} />

  if (active === 'team.browser') {
    return <BrowserView url={ctx.browserUrl} onNavigate={ctx.onBrowserNavigate} />
  }

  if (active === 'team.members') {
    return renderPage(
      'team.members',
      'Members',
      <Users className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <TeamMembersView
        teamId={scope.teamId}
        currentUserId={currentUserId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'team.agent-memories') {
    return renderPage(
      'team.agent-memories',
      'Memories',
      <Brain className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <AgentMemoriesView
        teamId={scope.teamId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onOpenAgentChat={onOpenAgentChat}
      />,
    )
  }
  if (active === 'team.archived-chats') {
    return renderPage(
      'team.archived-chats',
      'Archived chats',
      <Archive className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ArchivedChatsView
        teamId={scope.teamId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onOpenConversation={onOpenConversation}
      />,
    )
  }
  if (active === 'team.triggers' || active === 'team.schedule') {
    return renderPage(
      'team.triggers',
      'Triggers',
      <Clock className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <TriggersView
        teamId={scope.teamId}
        initialView={active === 'team.schedule' ? 'calendar' : undefined}
        currentUserId={currentUserId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        triggerDetail={triggerDetail}
        setTriggerDetail={setTriggerDetail}
        triggerForm={triggerForm}
        setTriggerForm={setTriggerForm}
        onOpenAgentChat={onOpenAgentChat}
      />,
    )
  }
  if (active === 'team.agent-skills') {
    return renderPage(
      'team.agent-skills',
      'Skills',
      <Sparkles className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <TeamSkillsView
        teamId={scope.teamId}
        currentUserId={currentUserId}
        refreshKey={refreshKey}
        filter={filter}
        onCount={onCount}
        onLoading={onLoading}
        onOpenAgentChat={onOpenAgentChat}
      />,
    )
  }
  if (active === 'team.plans') {
    return renderPage(
      'team.plans',
      'Plans',
      <ClipboardList className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <PlansView
        teamId={scope.teamId}
        refreshKey={refreshKey}
        filter={filter}
        onOpenPlan={(planNumber) => onSelectActive('team.plans', planNumber)}
        onCount={onCount}
        onLoading={onLoading}
        onOpenInChat={onOpenPlanInChat}
        isTeamAdmin={isTeamAdmin}
        onOpenAgentChat={onOpenAgentChat}
      />,
    )
  }
  if (active === 'team.audit') {
    return renderPage(
      'team.audit',
      'Audit log',
      <ScrollText className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <AuditLogView
        teamId={scope.teamId}
        refreshKey={refreshKey}
        filter={filter}
        onCount={onCount}
        onLoading={onLoading}
        onOpenConversation={onOpenAuditConversation}
      />,
    )
  }
  if (active === 'team.dashboards') {
    return renderPage(
      'team.dashboards',
      dashboardsPageTitle({ nuphosDashboard, nuphosDashboards, restoredTitle }),
      <ChartLine className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <NuphosDashboardsView
        teamId={scope.teamId}
        refreshKey={refreshKey}
        filter={filter}
        onCount={onCount}
        onLoading={onLoading}
        onOpenAgentChat={onOpenAgentChat}
        openDashboardId={nuphosDashboard?.dashboardId ?? null}
        viewRange={nuphosDashboard?.viewRange}
        onDashboardOpened={setNuphosDashboard}
        onDashboardsChange={setNuphosDashboards}
      />,
    )
  }
  if (active === 'team.architecture') {
    return renderPage(
      'team.architecture',
      'Architecture',
      <Network className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ArchitectureView
        teamId={scope.teamId}
        refreshKey={refreshKey}
        filter={filter}
        onCount={onCount}
        onLoading={onLoading}
        openDiagramId={architectureDetail?.diagramId ?? null}
        onOpenDiagram={(id, name) => setArchitectureDetail({ diagramId: id, diagramName: name })}
        onCloseDiagram={() => setArchitectureDetail(null)}
        onRenameDiagram={(name) =>
          architectureDetail
            ? setArchitectureDetail({ diagramId: architectureDetail.diagramId, diagramName: name })
            : undefined
        }
        onOpenUrl={onOpenNodeLink}
        onOpenAgentChat={onOpenAgentChat}
      />,
    )
  }
  if (active === 'team.monitoring') {
    return renderPage(
      'team.monitoring',
      'Monitoring',
      <HeartPulse className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <MonitoringView
        teamId={scope.teamId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onOpenAgentChat={onOpenAgentChat}
        onOpenConnectors={() => onSelectActive('team.integrations')}
      />,
    )
  }

  return undefined
}
