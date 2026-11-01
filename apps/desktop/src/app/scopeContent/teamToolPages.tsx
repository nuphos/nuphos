import {
  Archive,
  Bot,
  ChartLine,
  ClipboardList,
  HeartPulse,
  Inbox,
  Network,
  Palette,
  ScrollText,
  Users,
} from 'lucide-react'

import { NuphosDashboardsView } from '../../dashboards/NuphosDashboardsView'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import { dashboardsPageTitle } from '../../dashboards/view/pageTitle'
import { t } from '../../i18n'
import { ArchitectureView } from '../../views/ArchitectureView'
import { ArtifactView } from '../../views/ArtifactView'
import { ArchivedChatsView } from '../../views/ArchivedChatsView'
import { AuditLogView } from '../../views/AuditLogView'
import { BrowserView } from '../../views/BrowserView'
import { DesignsView } from '../../views/DesignsView'
import { DesktopView } from '../../views/DesktopView'
import { InboxView } from '../../views/InboxView'
import { MonitoringView } from '../../views/MonitoringView'
import { PlansView } from '../../views/PlansView'
import { RuntimeFilesView } from '../../views/RuntimeFilesView'
import { AgentSection } from '../../views/settings/AgentSection'
import { TeamMembersView } from '../../views/TeamMembersView'
import { TerminalView } from '../../views/TerminalView'

import type { ScopeRenderContext } from './context'

// Browser owns its dynamic page metadata; other pages use the shared wrapper.
// eslint-disable-next-line sonarjs/function-return-type
export function renderTeamToolPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    currentUserId,
    filter,
    onFilterChange,
    refreshKey,
    architectureDetail,
    setArchitectureDetail,
    designDetail,
    setDesignDetail,
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
      t('Runtimes'),
      <Bot className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <AgentSection
        key={scope.teamId}
        teamId={scope.teamId}
        isAdmin={isTeamAdmin}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onOpenSettingsSection={ctx.onOpenSettingsSection}
      />,
    )
  }

  if (active === 'team.files') {
    return <RuntimeFilesView key={filter} teamId={scope.teamId} filePath={filter} />
  }

  if (active === 'team.artifact') {
    return (
      <ArtifactView
        key={filter}
        teamId={scope.teamId}
        artifactId={filter}
        onAskAgent={(prompt) => ctx.openInChat(prompt, { mode: 'text' })}
        onOpenDesign={(designId) =>
          onOpenNodeLink(
            toAbsoluteAtlasUrl(
              pageLocationForNavigation(
                emptyNavigation(scope, 'team.designs', {
                  designDetail: { designId, designName: 'Design' },
                }),
              ).href,
            ),
          )
        }
      />
    )
  }

  if (active === 'team.terminal') return <TerminalView teamId={scope.teamId} filter={filter} />

  if (active === 'team.desktop')
    return <DesktopView teamId={scope.teamId} filter={filter} onFilterChange={onFilterChange} />

  if (active === 'team.browser') {
    return (
      <BrowserView
        teamId={scope.teamId}
        url={ctx.browserUrl}
        onNavigate={ctx.onBrowserNavigate}
        onComment={(text, filePaths) => ctx.openInChat(text, { mode: 'text', filePaths })}
      />
    )
  }

  if (active === 'team.members') {
    return renderPage(
      'team.members',
      t('Members'),
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
  if (active === 'team.archived-chats') {
    return renderPage(
      'team.archived-chats',
      t('Archived agents'),
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
  if (active === 'team.inbox') {
    return renderPage(
      'team.inbox',
      t('Inbox'),
      <Inbox className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <InboxView
        teamId={scope.teamId}
        query={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onOpenConversation={onOpenConversation}
      />,
    )
  }
  if (active === 'team.plans') {
    return renderPage(
      'team.plans',
      t('Plans'),
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
      t('Audit log'),
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
      t('Architecture'),
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
  if (active === 'team.designs') {
    return renderPage(
      'team.designs',
      'Designs',
      <Palette className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <DesignsView
        teamId={scope.teamId}
        refreshKey={refreshKey}
        filter={filter}
        onCount={onCount}
        onLoading={onLoading}
        openDesignId={designDetail?.designId ?? null}
        openDesignName={designDetail?.designName ?? null}
        onOpenDesign={(id, name) => setDesignDetail({ designId: id, designName: name })}
        onCloseDesign={() => setDesignDetail(null)}
        onRenameDesign={(name) =>
          designDetail
            ? setDesignDetail({ designId: designDetail.designId, designName: name })
            : undefined
        }
        onOpenAgentChat={onOpenAgentChat}
      />,
    )
  }
  if (active === 'team.monitoring') {
    return renderPage(
      'team.monitoring',
      t('Monitoring'),
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
