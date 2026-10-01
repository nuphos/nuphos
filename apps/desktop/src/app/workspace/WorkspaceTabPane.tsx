import clsx from 'clsx'
import { memo, useCallback, useMemo } from 'react'

import { KubeContextProvider } from '../../hooks/KubeContextProvider'
import { WorkspaceTabContext } from '../../hooks/useWorkspaceTab'
import { hasCloudOnboardingBinding } from '../../lib/connectorCategories'
import { connectKubernetesCluster } from '../../lib/kubernetesCluster'
import { WorkspaceRowLinkProvider } from '../../lib/WorkspaceRowLinkProvider'
import { DEFAULT_GITLAB_NAV } from '../../views/gitlabNav'
import { connectedResourceLabels } from '../accountScopes'
import { PageMetaContext } from '../pageMetaContext'
import { ScopeContent } from '../scopeContent/ScopeContent'
import { pageLocationForTab } from '../workspaceTabFactory'

import { PaneAgentPage } from './PaneAgentPage'
import { useTabClusterPickers } from './useTabClusterPickers'
import { useTabConnectorActions } from './useTabConnectorActions'
import { useTabDetailSetters } from './useTabDetailSetters'
import { useTabPageMeta } from './useTabPageMeta'
import { useTabViewSetters } from './useTabViewSetters'
import { WorkspaceNewTabPage } from './WorkspaceNewTabPage'

import type { WorkspaceTabPaneProps } from './paneTypes'

// Memoized: the workspace re-renders several times per tab switch, and without
// this every one of those re-rendered every mounted tab's whole page tree — the
// panes the user cannot see were measured costing 233-273ms of the ~350ms wait.
export const WorkspaceTabPane = memo(
  ({
    tab,
    active,
    mounted,
    accounts,
    firstRunDevForced,
    databaseConnections,
    githubInstallations,
    gitlabBindings,
    grafanaInstances,
    user,
    rootIntegrations,
    rootIntegrationsLoading,
    scopeChipForPath,
    onOpenPath,
    onOpenKey,
    onDockAgentToSidebar,
    pendingPageImport,
    onPagePendingImportConsumed,
    pendingChatPrompt,
    onChatPromptConsumed,
    onOpenNuphosLink,
    onOpenNodeLink,
    onOpenPlanInChat,
    onOpenConversation,
    railCollapsed,
    onAgentSessionTitle,
    onOpenAuditConversation,
    copyLink,
    openInChat,
    onOpenAgentChat,
    onStartFirstRunConnect,
    updateTab,
    onFilterChange,
    enterScopeInTab,
    enterCluster,
    openLightsailSshTab,
    openEc2SshTab,
    openGceSshTab,
    onRequestBindGithub,
    onRequestBindGitlab,
    onOpenSettingsSection,
    slackBindRequested,
    onSlackBindHandled,
    isTeamAdmin,
    agentPaid,
    renderAgentPage = true,
    dockVisible = true,
  }: WorkspaceTabPaneProps) => {
    const tabId = tab.id
    const onBrowserNavigate = useCallback(
      (url: string) => {
        updateTab(
          tabId,
          (current) => (current.browserUrl === url ? current : { ...current, browserUrl: url }),
          { history: 'replace' },
        )
      },
      [tabId, updateTab],
    )
    // Bound here rather than at the call site: a closure built per tab in the
    // workspace's render is a new identity every time, and the memo would never
    // hold.
    const paneTeamId = tab.scope.kind === 'team' ? tab.scope.teamId : null
    const onRailCollapsedChange = useCallback(
      (collapsed: boolean) =>
        updateTab(tabId, (cur) => ({ ...cur, agentRailCollapsed: collapsed })),
      [tabId, updateTab],
    )
    const onConnectGithub = useCallback(() => {
      if (paneTeamId) onRequestBindGithub({ teamId: paneTeamId, tabId })
    }, [paneTeamId, tabId, onRequestBindGithub])
    const onConnectGitlab = useCallback(() => {
      if (paneTeamId) onRequestBindGitlab({ teamId: paneTeamId, tabId })
    }, [paneTeamId, tabId, onRequestBindGitlab])
    const namespace = tab.scope.kind === 'cluster' ? (tab.scope.namespace ?? '') : ''

    // RBAC mask re-check: re-fetch the cluster's kubeconfig and point the tab at
    // the returned context before re-probing. For VKE this issues a FRESH
    // credential — VKE materializes in-cluster RBAC bindings at kubeconfig issue
    // time, so a grant made after connecting never applies to the already-loaded
    // credential and a plain probe retry would 403 forever.
    const refreshClusterKubeconfig = useCallback(async () => {
      const scope = tab.scope

      if (scope.kind !== 'cluster') return
      const r = await connectKubernetesCluster(scope, { fresh: true })

      updateTab(tabId, (cur) => ({
        ...cur,
        kubeconfigContext: r.context,
        kubeconfigContextError: null,
      }))
    }, [tab.scope, tabId, updateTab])

    const detailSetters = useTabDetailSetters(tabId, updateTab)
    const pageHref = pageLocationForTab(tab).href
    // "Has this team connected a cloud?" — the same question the sidebar's
    // first-run checklist asks, off the same provider list, so the two can't
    // disagree. Deliberately NOT accountSetHasAnyBinding: that counts Slack and
    // the other chat surfaces, and a team whose only connector is Slack has
    // nothing for the agent to look at.
    const agentUnbound = useMemo(() => {
      if (firstRunDevForced) return true
      if (accounts === undefined) return false

      return !hasCloudOnboardingBinding(accounts)
    }, [accounts, firstRunDevForced])
    // Labels for the team's bound integrations — drives the agent home page's
    // LLM-generated starter suggestions once at least one connector exists.
    const agentConnectedResources = useMemo(
      () =>
        connectedResourceLabels(
          accounts,
          githubInstallations.length,
          gitlabBindings.length,
          grafanaInstances.length,
        ),
      [accounts, githubInstallations.length, gitlabBindings.length, grafanaInstances.length],
    )
    const viewSetters = useTabViewSetters(tabId, updateTab)
    const connectorActions = useTabConnectorActions({ tabId, tab, enterScopeInTab })
    const clusterPickers = useTabClusterPickers({
      tabId,
      tab,
      accounts,
      enterScopeInTab,
      enterCluster,
    })
    const { setPageMeta, pageMetaContext, rowLinkValue, workspaceTabContextValue } = useTabPageMeta(
      { tabId, tab, active, pageHref, updateTab, copyLink, openInChat },
    )

    return (
      <WorkspaceRowLinkProvider value={rowLinkValue}>
        <WorkspaceTabContext.Provider value={workspaceTabContextValue}>
          <div className={clsx(active ? 'h-full min-w-0 flex flex-col relative' : 'hidden')}>
            {mounted && (
              <div className="flex-1 min-h-0 flex">
                <div
                  className={clsx(
                    'flex-1 min-w-0 min-h-0 overflow-auto scrollbar-thin',
                    tab.active === 'team.agent' && 'hidden',
                  )}
                >
                  <div className="h-full min-w-0 flex flex-col">
                    <PageMetaContext.Provider value={pageMetaContext}>
                      <KubeContextProvider context={tab.kubeconfigContext}>
                        {tab.active === 'team.new-tab' ? (
                          <WorkspaceNewTabPage
                            focusSearch={active && dockVisible}
                            userId={user.id}
                            teamId={tab.scope.teamId}
                            rootIntegrations={rootIntegrations}
                            loading={rootIntegrationsLoading}
                            currentHref={pageHref}
                            scopeChipForPath={scopeChipForPath}
                            onOpenPath={onOpenPath}
                            onOpenKey={onOpenKey}
                          />
                        ) : (
                          <ScopeContent
                            {...detailSetters}
                            {...viewSetters}
                            {...connectorActions}
                            {...clusterPickers}
                            scope={tab.scope}
                            active={tab.active}
                            databaseConnections={databaseConnections}
                            currentUserId={user.id}
                            filter={tab.filter}
                            browserUrl={tab.browserUrl}
                            onBrowserNavigate={onBrowserNavigate}
                            onFilterChange={onFilterChange}
                            refreshKey={tab.refreshKey}
                            kubeconfigContext={tab.kubeconfigContext}
                            kubeconfigContextError={tab.kubeconfigContextError}
                            namespace={namespace}
                            accounts={accounts}
                            githubInstallations={githubInstallations}
                            gitlabBindings={gitlabBindings}
                            grafanaInstances={grafanaInstances}
                            target={tab.target}
                            s3Detail={tab.s3Detail}
                            architectureDetail={tab.architectureDetail ?? null}
                            triggerDetail={tab.triggerDetail ?? null}
                            triggerForm={tab.triggerForm ?? null}
                            nuphosDashboard={tab.nuphosDashboard ?? null}
                            nuphosDashboards={tab.nuphosDashboards}
                            linearNav={tab.linearNav ?? null}
                            restoredTitle={tab.restoredTitle}
                            connectorDetail={tab.connectorDetail ?? null}
                            awsDetail={tab.awsDetail ?? null}
                            cloudflareDetail={tab.cloudflareDetail ?? null}
                            addIntegrationOpen={tab.addIntegrationOpen ?? false}
                            grafanaInstance={tab.grafanaInstance}
                            dashboardTarget={tab.dashboardTarget}
                            traceDatasourceTarget={tab.traceDatasourceTarget}
                            logDatasourceTarget={tab.logDatasourceTarget}
                            sshTerminal={tab.sshTerminal}
                            githubNav={tab.githubNav}
                            gitlabNav={tab.gitlabNav ?? DEFAULT_GITLAB_NAV}
                            repoProvider={tab.repoProvider}
                            onConnectGithub={onConnectGithub}
                            onConnectGitlab={onConnectGitlab}
                            onOpenSettingsSection={onOpenSettingsSection}
                            slackBindRequested={slackBindRequested}
                            onSlackBindHandled={onSlackBindHandled}
                            enterCluster={enterCluster}
                            refreshClusterKubeconfig={refreshClusterKubeconfig}
                            onOpenLightsailSsh={openLightsailSshTab}
                            onOpenEc2Ssh={openEc2SshTab}
                            onOpenGceSsh={openGceSshTab}
                            openInChat={openInChat}
                            onOpenAgentChat={onOpenAgentChat}
                            onOpenPlanInChat={onOpenPlanInChat}
                            onOpenConversation={onOpenConversation}
                            isTeamAdmin={isTeamAdmin}
                            onOpenAuditConversation={onOpenAuditConversation}
                            onOpenNodeLink={onOpenNodeLink}
                          />
                        )}
                      </KubeContextProvider>
                    </PageMetaContext.Provider>
                  </div>
                </div>
                {renderAgentPage && (
                  <PaneAgentPage
                    tab={tab}
                    user={user}
                    active={active}
                    railCollapsed={railCollapsed}
                    isTeamAdmin={isTeamAdmin}
                    agentPaid={agentPaid}
                    pageHref={pageHref}
                    agentUnbound={agentUnbound}
                    agentConnectedResources={agentConnectedResources}
                    pendingPageImport={pendingPageImport}
                    pendingChatPrompt={pendingChatPrompt}
                    onDockAgentToSidebar={onDockAgentToSidebar}
                    updateTab={updateTab}
                    onAgentSessionTitle={onAgentSessionTitle}
                    onOpenConversation={onOpenConversation}
                    onRailCollapsedChange={onRailCollapsedChange}
                    onOpenNuphosLink={onOpenNuphosLink}
                    onOpenSettingsSection={onOpenSettingsSection}
                    onStartFirstRunConnect={onStartFirstRunConnect}
                    onPagePendingImportConsumed={onPagePendingImportConsumed}
                    onChatPromptConsumed={onChatPromptConsumed}
                    setPageMeta={setPageMeta}
                  />
                )}
              </div>
            )}
            {tab.switching && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-main text-tertiary text-[12.5px]">
                <div className="w-6 h-6 rounded-full border-2 border-zGray-700 border-t-zViolet-accent animate-spin" />
                <div>
                  Connecting to <span className="text-secondary">{tab.clusterLabel}</span>…
                </div>
              </div>
            )}
          </div>
        </WorkspaceTabContext.Provider>
      </WorkspaceRowLinkProvider>
    )
  },
)
