import { useCallback, useEffect } from 'react'

import { hydrateNavigationCredentialState } from '../../app/accountScopes'
import { navigationFromMentionTarget } from '../../app/mentionNavigation'
import { scopeChip } from '../../app/scopeChip'
import {
  createWorkspaceTab,
  createWorkspaceTabFromNavigation,
  pageLocationForTab,
  retargetWorkspaceTabToNavigation,
  tabOpenedFrom,
} from '../../app/workspaceTabFactory'
import {
  navigationFromAppPath,
  pageLocationForNavigation,
  teamIdFromAppPath,
} from '../../lib/appRoutes'
import { parseAtlasLink } from '../../lib/atlasLinkMention'
import { isTeamId } from '../../lib/teamId'
import { ATLAS_WEB_BASE_URL, toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'

import { selectActiveTab, selectCurrentBucket, selectScope } from './store/workspaceState'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
import type { WorkspaceBreadcrumbResult } from './useWorkspaceBreadcrumb'
import type { WorkspaceClusterEntryResult } from './useWorkspaceClusterEntry'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceScopeActionsResult } from './useWorkspaceScopeActions'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceSidebarNavResult } from './useWorkspaceSidebarNav'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTakeoverResult } from './useWorkspaceTakeover'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceToolbarResult } from './useWorkspaceToolbar'
import type { WorkspaceProps } from './workspaceProps'
import type { AppOpenDeepLinkPayload } from '../../api'

const ROUTE_TABLE_FIRST = new Set<string>(['cluster', 'github-repo', 'github-pr'])

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult &
  WorkspaceNamespacesResult &
  WorkspaceAccountsResult &
  WorkspaceScopeActionsResult &
  WorkspaceAgentLinksResult &
  WorkspaceTakeoverResult &
  WorkspaceClusterEntryResult &
  WorkspaceSidebarNavResult &
  WorkspaceBreadcrumbResult &
  WorkspaceToolbarResult

export function useWorkspaceLinkOpeners(a: Args) {
  const {
    accountsByTeam,
    databaseConnectionsByTeam,
    workspaceStore,
    workspaceActions,
    updateTab,
    updateActiveTab,
    accounts,
    openInChat,
    openConversationInNewTab,
  } = a
  const openSessionBeside = useWorkspacePane()?.openSessionBeside

  const newTab = useCallback(() => {
    const teamId = selectScope(workspaceStore.getState())?.teamId

    if (!teamId) return
    workspaceActions.openTab(createWorkspaceTab(teamId), { openDock: true })
  }, [workspaceActions, workspaceStore])

  const openNuphosLinkInNewTab = useCallback(
    (href: string, beside = false): boolean => {
      const trimmed = href.trim()
      let url: URL

      try {
        url = new URL(trimmed, ATLAS_WEB_BASE_URL)
      } catch {
        return false
      }

      const isRelativeNuphosLink = trimmed.startsWith('/teams/')
      const isCanonicalNuphosLink = url.origin === ATLAS_WEB_BASE_URL

      if (!isRelativeNuphosLink && !isCanonicalNuphosLink) return false
      if (!url.pathname.startsWith('/teams/')) return false

      // Resource-level mention links first (they carry filter/label niceties);
      // anything else the route table can parse — section pages, drill-downs,
      // legacy aliases — resolves through the shared parser.
      const target = parseAtlasLink(url.toString())
      const mentionNavigation =
        target && !ROUTE_TABLE_FIRST.has(target.type) ? navigationFromMentionTarget(target) : null
      const navigation =
        mentionNavigation ??
        navigationFromAppPath(`${url.pathname}${url.search}`) ??
        (target ? navigationFromMentionTarget(target) : null)

      if (!navigation) return false

      if (beside) {
        const sessionId = navigation.active === 'team.agent' ? navigation.agentSessionId : null

        // Message text is untrusted: a malformed team id falls back to the pane's team.
        const teamId = isTeamId(navigation.scope.teamId) ? navigation.scope.teamId : undefined

        return Boolean(sessionId && openSessionBeside?.(sessionId, teamId))
      }
      if (navigation.active === 'team.agent') {
        if (navigation.agentSessionId) {
          openConversationInNewTab(navigation.agentSessionId, navigation.scope.teamId)
        } else {
          workspaceActions.selectSession(null)
        }

        return true
      }

      const hydratedNavigation = hydrateNavigationCredentialState(navigation, accountsByTeam)
      const targetHref = pageLocationForNavigation(hydratedNavigation).href
      const state = workspaceStore.getState()
      const existing = selectCurrentBucket(state).tabs.find(
        (item) => pageLocationForTab(item).href === targetHref,
      )

      if (existing) {
        updateTab(existing.id, (tab) => retargetWorkspaceTabToNavigation(tab, hydratedNavigation))
        workspaceActions.activateTab(existing.id)
        workspaceActions.setDockOpen(true)

        return true
      }
      const tab = tabOpenedFrom(
        selectActiveTab(state),
        createWorkspaceTabFromNavigation(hydratedNavigation),
      )

      workspaceActions.openTab(tab, { replaceLoneFreshTab: true, openDock: true })

      return true
    },
    [
      accountsByTeam,
      openConversationInNewTab,
      openSessionBeside,
      updateTab,
      workspaceActions,
      workspaceStore,
    ],
  ) // Views outside the workspace (Settings) ask for an in-app tab with this event.

  useEffect(() => {
    const open = (event: Event) => {
      const href = (event as CustomEvent<string>).detail

      if (typeof href === 'string') openNuphosLinkInNewTab(href)
    }

    window.addEventListener('nuphos:open-in-app', open)

    return () => window.removeEventListener('nuphos:open-in-app', open)
  }, [openNuphosLinkInNewTab])

  const openAppOpenDeepLink = useCallback(
    (payload: AppOpenDeepLinkPayload) => {
      // A bare team link keeps its historical "activate the team's tab"
      // semantics instead of resolving to a fresh team-home tab.
      const [pathnameOnly] = payload.path.split(/[?#]/, 1)
      const isBareTeamPath = /^\/teams\/[^/]+\/?$/.test(pathnameOnly)

      if (!isBareTeamPath && openNuphosLinkInNewTab(payload.path)) return

      const teamId = teamIdFromAppPath(payload.path)

      if (teamId) {
        workspaceActions.openTeamTab(teamId)

        return
      }

      openInChat(payload.url, { forceOpen: true })
    },
    [openInChat, openNuphosLinkInNewTab, workspaceActions],
  )

  const scopeChipForPath = useCallback(
    (href: string) => {
      const navigation = navigationFromAppPath(href)

      if (!navigation) return null

      return scopeChip(
        navigation.scope,
        accounts,
        databaseConnectionsByTeam[navigation.scope.teamId] ?? [],
        null,
      )
    },
    [accounts, databaseConnectionsByTeam],
  )

  // Favorites captured from a tab (href entries) get the same shortcut
  // semantics as key entries: the deep-link resolver reuses or opens a tab,
  // then the favorite's name is stamped onto whichever tab now shows that page.
  const onSidebarOpenPath = useCallback(
    (href: string, favoriteLabel: string, newTab: boolean) => {
      const favoriteTitle = { title: favoriteLabel, href }
      // A plain click retargets the current tab, matching how every other
      // sidebar row behaves. Paths the route table can't parse fall through to
      // the deep-link resolver, which knows the remaining tricks.
      const navigation = !newTab ? navigationFromAppPath(href) : null

      if (navigation) {
        const hydrated = hydrateNavigationCredentialState(navigation, accountsByTeam)

        updateActiveTab((tab) => ({
          ...retargetWorkspaceTabToNavigation(tab, hydrated),
          favoriteTitle,
        }))

        return
      }
      openAppOpenDeepLink({ path: href, url: toAbsoluteAtlasUrl(href) })
      workspaceActions.mapTabs((tab) =>
        pageLocationForTab(tab).href === href ? { ...tab, favoriteTitle } : tab,
      )
    },
    [accountsByTeam, openAppOpenDeepLink, updateActiveTab, workspaceActions],
  )

  return {
    newTab,
    openNuphosLinkInNewTab,
    openAppOpenDeepLink,
    scopeChipForPath,
    onSidebarOpenPath,
  }
}

export type WorkspaceLinkOpenersResult = ReturnType<typeof useWorkspaceLinkOpeners>
