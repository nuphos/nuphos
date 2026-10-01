import { api } from '../../api'

import {} from '../../app/sidebarBackTarget'
import { pageLocationForTab } from '../../app/workspaceTabFactory'
import { setActiveTeam, trackPageview } from '../../lib/analytics'
import { DEFAULT_GITHUB_NAV, DEFAULT_REPO_PROVIDER } from '../../lib/appRoutes'
import { externalPageLink } from '../../lib/externalPageLink'
import { canStepNavigation } from '../../lib/navHistory'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceProps } from './workspaceProps'
import type { RepoProvider } from '../../lib/appRoutes'
import type { AtlasTeam } from '../../types'

type Args = WorkspaceProps & WorkspaceShellStateResult

export function useWorkspaceActiveTab(a: Args) {
  const paneActive = useWorkspacePane()?.active ?? true
  const { teams, setTeams, tabs, activeTabId, workspaceScope, pendingChatPromptQueue } = a

  // The tab strip is immutable state and this is a plain lookup into it, so the
  // memo buys no work — what it buys is a *frozen* result. Everything this
  // component derives (`scope`, `active`, `target`, `sshTerminal`, …) hangs off
  // this one value, and the tab it returns is handed to module helpers
  // (`pageLocationForTab`, `canStepNavigation`, `tabOpenedFrom`, …) from inside
  // callbacks. Those helpers only read, but the React Compiler cannot see
  // across a call, so an unmemoized `find` result is a value that "may be
  // mutated later" — which invalidated every `useCallback`/`useMemo` in
  // `Workspace` that touches tab state and made the compiler skip the component
  // wholesale. Fixing the value once at the derivation point beats re-proving
  // purity at ~40 call sites.
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
  )
  const pendingChatPrompt = pendingChatPromptQueue[0] ?? null
  const activePageUrl = activeTab
    ? toAbsoluteAtlasUrl(pageLocationForTab(activeTab).href)
    : undefined
  const activeExternalLink = useMemo(
    () => (activeTab ? externalPageLink(activeTab) : null),
    [activeTab],
  )
  const toolbarPageUrl = activeExternalLink?.url ?? activePageUrl
  const scope = workspaceScope
  const currentTeam = scope ? teams.find((team) => team.id === scope.teamId) : undefined
  const active = activeTab?.active ?? ''
  const filter = activeTab?.filter ?? ''
  const refreshKey = activeTab?.refreshKey ?? 0
  const count = activeTab?.count ?? 0
  const viewLoading = activeTab?.viewLoading ?? false
  const target = activeTab?.target ?? null
  const s3Detail = activeTab?.s3Detail ?? null
  const architectureDetail = activeTab?.architectureDetail ?? null
  const nuphosDashboard = activeTab?.nuphosDashboard ?? null
  const nuphosDashboards = activeTab?.nuphosDashboards
  const linearNav = activeTab?.linearNav ?? null
  const connectorDetail = activeTab?.connectorDetail ?? null
  const triggerDetail = activeTab?.triggerDetail ?? null
  const triggerForm = activeTab?.triggerForm ?? null
  // Title of the conversation the Agent page is showing, per tab — the
  // breadcrumb's leaf. The panel publishes it; the tab's own label comes from
  // pageMeta, which the page sets from the same value.
  const [agentTitleByTab, setAgentTitleByTab] = useState<Record<string, string>>({})
  const setAgentSessionTitle = useCallback((tabId: string, title: string) => {
    setAgentTitleByTab((prev) => (prev[tabId] === title ? prev : { ...prev, [tabId]: title }))
  }, [])
  const agentSessionTitle =
    activeTabId && activeTab?.agentSessionId ? (agentTitleByTab[activeTabId] ?? null) : null
  const awsDetail = activeTab?.awsDetail ?? null
  const cloudflareDetail = activeTab?.cloudflareDetail ?? null
  const grafanaInstance = activeTab?.grafanaInstance ?? null
  const dashboardTarget = activeTab?.dashboardTarget ?? null
  const traceDatasourceTarget = activeTab?.traceDatasourceTarget ?? null
  const logDatasourceTarget = activeTab?.logDatasourceTarget ?? null
  const sshTerminal = activeTab?.sshTerminal ?? null
  const githubNav = activeTab?.githubNav ?? DEFAULT_GITHUB_NAV
  const repoProvider: RepoProvider = activeTab?.repoProvider ?? DEFAULT_REPO_PROVIDER
  // Inside an agent conversation the left "Agent" item is just an entry point
  // to Home, not the current location — so it must not look active once you're
  // reading a chat. A non-matching sentinel keeps every sidebar item
  // un-highlighted there (and sidebarBackTarget returns null for it, same as a
  // plain team page).
  const inAgentConversation =
    scope?.kind === 'team' && active === 'team.agent' && Boolean(activeTab?.agentSessionId)
  const sidebarActive = inAgentConversation
    ? 'team.agent-conversation'
    : scope?.kind === 'team' && active === 'team.repository' && githubNav.view === 'repo'
      ? `github.${githubNav.tab}`
      : active
  const sidebarRepositoryNav =
    scope?.kind === 'team' && active === 'team.repository' && githubNav.view === 'repo'
      ? { repoName: githubNav.repo.name, tab: githubNav.tab }
      : undefined
  const canGoBack = activeTab !== null && canStepNavigation(activeTab, -1)
  const canGoForward = activeTab !== null && canStepNavigation(activeTab, 1)
  const namespaces = activeTab?.namespaces ?? []
  const handleTeamUpdated = useCallback(
    (updated: AtlasTeam) => {
      setTeams((prev) =>
        prev.map((team) => (team.id === updated.id ? { ...team, ...updated } : team)),
      )
    },
    [setTeams],
  )
  const switching = activeTab?.switching ?? false
  const clusterLabel = activeTab?.clusterLabel ?? null
  const closedSshTabsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    return api.onAgentPlanUpdated(({ plan }) => {
      window.dispatchEvent(new CustomEvent('atlas-plan-updated', { detail: { plan } }))
    })
  }, [])

  // Keep analytics pointed at the team the user is actually working in. The
  // active tab's scope is the single source of truth — it moves both when the
  // user switches team inside a tab and when they switch to a tab belonging to
  // another team. Declared before the pageview effect so the pageview that
  // follows a team switch already carries the new team_id.
  const activeTeamId = scope?.teamId ?? null

  useEffect(() => {
    if (paneActive) setActiveTeam(activeTeamId)
  }, [paneActive, activeTeamId])

  // Emit a PostHog pageview whenever the active tab's logical location changes.
  // Navigation here is tab/scope-based rather than URL-based, so we drive
  // pageviews off pageMeta.location instead of browser history.
  const activeLocationHref = activeTab?.pageMeta?.location.href ?? null

  useEffect(() => {
    if (!paneActive || !activeTab?.pageMeta) return
    trackPageview(activeTab.pageMeta.location, {
      scope_kind: activeTab.scope.kind,
      active_key: activeTab.active,
      title: activeTab.pageMeta.title,
    })
    // activeLocationHref is the change signal; other fields are read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneActive, activeLocationHref])

  return {
    activeTab,
    pendingChatPrompt,
    activePageUrl,
    activeExternalLink,
    toolbarPageUrl,
    scope,
    currentTeam,
    active,
    filter,
    refreshKey,
    count,
    viewLoading,
    target,
    s3Detail,
    architectureDetail,
    nuphosDashboard,
    nuphosDashboards,
    linearNav,
    connectorDetail,
    triggerDetail,
    triggerForm,
    setAgentSessionTitle,
    agentSessionTitle,
    awsDetail,
    cloudflareDetail,
    grafanaInstance,
    dashboardTarget,
    traceDatasourceTarget,
    logDatasourceTarget,
    sshTerminal,
    githubNav,
    repoProvider,
    sidebarActive,
    sidebarRepositoryNav,
    canGoBack,
    canGoForward,
    namespaces,
    handleTeamUpdated,
    switching,
    clusterLabel,
    closedSshTabsRef,
  }
}

export type WorkspaceActiveTabResult = ReturnType<typeof useWorkspaceActiveTab>
