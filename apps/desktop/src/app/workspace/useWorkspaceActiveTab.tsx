import { api } from '../../api'

import {} from '../../app/sidebarBackTarget'
import { pageLocationForTab } from '../../app/workspaceTabFactory'
import { sourceText } from '../../i18n'
import { setActiveTeam, trackPageview } from '../../lib/analytics'
import { externalPageLink } from '../../lib/externalPageLink'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { tabFields } from './tabFields'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceProps } from './workspaceProps'
import type { AtlasTeam } from '../../types'
import type { WorkspaceTabState } from '../workspaceTabState'

type Args = WorkspaceProps & WorkspaceShellStateResult

/**
 * Emits a PostHog pageview whenever the page's logical location changes.
 * Navigation here is tab/scope-based rather than URL-based, so pageviews are
 * driven off pageMeta.location instead of browser history.
 */
export function usePageview(tab: WorkspaceTabState | null, paneActive: boolean) {
  const locationHref = tab?.pageMeta?.location.href ?? null

  useEffect(() => {
    if (!paneActive || !tab?.pageMeta) return
    trackPageview(tab.pageMeta.location, {
      scope_kind: tab.scope.kind,
      active_key: tab.active,
      // English, so pageviews group the same way in every locale.
      title: sourceText(tab.pageMeta.title),
    })
    // locationHref is the change signal; other fields are read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneActive, locationHref])
}

export function useWorkspaceActiveTab(a: Args) {
  const paneActive = useWorkspacePane()?.active ?? true
  const { teams, setTeams, tabs, activeTabId, workspaceScope, pendingChatPromptQueue } = a

  // The tab strip is immutable state and this is a plain lookup into it, so the
  // memo buys no work — what it buys is a *frozen* result. Everything this
  // component derives (`scope`, `active`, `target`, `sshTerminal`, …) hangs off
  // this one value, and the tab it returns is handed to module helpers
  // (`pageLocationForTab`, `tabOpenedFrom`, …) from inside
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
  const {
    active,
    filter,
    refreshKey,
    count,
    viewLoading,
    target,
    s3Detail,
    architectureDetail,
    designDetail,
    nuphosDashboard,
    nuphosDashboards,
    linearNav,
    connectorDetail,
    awsDetail,
    cloudflareDetail,
    grafanaInstance,
    dashboardTarget,
    traceDatasourceTarget,
    logDatasourceTarget,
    sshTerminal,
    githubNav,
    repoProvider,
    namespaces,
    switching,
    clusterLabel,
  } = tabFields(activeTab)
  // Title of the conversation the Agent page is showing, per tab — the
  // breadcrumb's leaf. The panel publishes it; the tab's own label comes from
  // pageMeta, which the page sets from the same value.
  const [agentTitleByTab, setAgentTitleByTab] = useState<Record<string, string>>({})
  const setAgentSessionTitle = useCallback((tabId: string, title: string) => {
    setAgentTitleByTab((prev) => (prev[tabId] === title ? prev : { ...prev, [tabId]: title }))
  }, [])
  const agentSessionTitle =
    activeTabId && activeTab?.agentSessionId ? (agentTitleByTab[activeTabId] ?? null) : null
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
  const handleTeamUpdated = useCallback(
    (updated: AtlasTeam) => {
      setTeams((prev) =>
        prev.map((team) => (team.id === updated.id ? { ...team, ...updated } : team)),
      )
    },
    [setTeams],
  )
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

  usePageview(activeTab, paneActive)

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
    designDetail,
    nuphosDashboard,
    nuphosDashboards,
    linearNav,
    connectorDetail,
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
    namespaces,
    handleTeamUpdated,
    switching,
    clusterLabel,
    closedSshTabsRef,
  }
}

export type WorkspaceActiveTabResult = ReturnType<typeof useWorkspaceActiveTab>
