import { useCallback, useEffect, useMemo } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useStableCallback } from '../../hooks/useStableCallback'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import {
  appPathForExternalLink,
  isBindableGithubLink,
  isBindableLinearLink,
} from '../../lib/external-link'
import { mergeIfChanged } from '../../lib/mergeIfChanged'
import { runtimeFilePathFromHref } from '../../lib/runtimeFileLink'
import { isAppWebUrl } from '../../lib/webBaseUrl'

import { useChatLinkMenuActions } from './useChatLinkMenuActions'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
import type { WorkspaceBreadcrumbResult } from './useWorkspaceBreadcrumb'
import type { WorkspaceClusterEntryResult } from './useWorkspaceClusterEntry'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceLinkOpenersResult } from './useWorkspaceLinkOpeners'
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
import type { BoundResources } from '../../lib/external-link'

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
  WorkspaceToolbarResult &
  WorkspaceLinkOpenersResult

export function useWorkspaceChatLinks(a: Args) {
  const paneActive = useWorkspacePane()?.active ?? true
  const {
    dockAgentToSidebar,
    openInChat,
    openAgentChatWithPrompt,
    openPlanInChat,
    enterCluster,
    openConversationHere,
    openNuphosLinkInNewTab,
    openAppOpenDeepLink,
    copyLink,
    teamId,
    accountsByTeam,
    setAccountsByTeam,
    githubInstallationsByTeam,
    setGithubInstallationsByTeam,
    grafanaInstancesByTeam,
  } = a
  const githubInstallations = teamId ? githubInstallationsByTeam[teamId] : undefined
  const accounts = teamId ? accountsByTeam[teamId] : undefined
  const grafanaInstances = teamId ? grafanaInstancesByTeam[teamId] : undefined
  const boundResources = useMemo<BoundResources>(
    () => ({
      github: githubInstallations ?? [],
      grafana: grafanaInstances ?? [],
      aws: accounts?.aws ?? [],
      gcp: accounts?.gcp ?? [],
      cloudflare: accounts?.cloudflare ?? [],
      linear: accounts?.linear ?? [],
    }),
    [accounts, githubInstallations, grafanaInstances],
  )

  const openExternalLink = useCallback((url: string) => {
    void api.appOpenExternal(url).catch(() => {
      toast.error('Failed to open link')
    })
  }, [])

  const openBrowserLink = useCallback(
    (url: string, beside = false): boolean => {
      if (!teamId || !/^https?:\/\//i.test(url)) return false

      return openNuphosLinkInNewTab(
        pageLocationForNavigation(
          emptyNavigation({ kind: 'team', teamId }, 'team.browser', { browserUrl: url }),
        ).href,
        beside,
      )
    },
    [openNuphosLinkInNewTab, teamId],
  )

  // A provider link carries the provider's own ids, not Nuphos's: the bound
  // installation / instance / account the URL points into is what names the
  // in-app page. Anything not bound stays in the browser.
  const openBoundProviderLinkFromChat = useCallback(
    (href: string): boolean => {
      if (!teamId) return false

      const openResolved = (bound: BoundResources): boolean => {
        const path = appPathForExternalLink(href, teamId, bound)

        return path !== null && openNuphosLinkInNewTab(path)
      }

      if (openResolved(boundResources)) return true
      if (!isBindableGithubLink(href) && !isBindableLinearLink(href)) return false

      // A cache miss may just be a stale cache (installation/workspace bound
      // after the sidebar loaded), so confirm against the backend before
      // giving up.
      void (async () => {
        try {
          if (isBindableGithubLink(href)) {
            const installations = await api.atlasListGithubInstallations(teamId)

            setGithubInstallationsByTeam((prev) => mergeIfChanged(prev, teamId, installations))
            if (openResolved({ ...boundResources, github: installations })) return
          } else {
            const workspaces = await api.atlasListLinearWorkspaces(teamId)

            setAccountsByTeam((prev) => {
              const cur = prev[teamId]

              return cur ? { ...prev, [teamId]: { ...cur, linear: workspaces } } : prev
            })
            if (openResolved({ ...boundResources, linear: workspaces })) return
          }
        } catch {
          // Resolution is best-effort. The original URL remains usable.
        }
        if (!openBrowserLink(href)) openExternalLink(href)
      })()

      // Claim the click immediately while resolution runs so the anchor's
      // target=_blank fallback cannot race an internal navigation.
      return true
    },
    [
      boundResources,
      openBrowserLink,
      openExternalLink,
      openNuphosLinkInNewTab,
      setAccountsByTeam,
      setGithubInstallationsByTeam,
      teamId,
    ],
  )

  // Unified policy for opening a link from a clickable surface (e.g. an
  // architecture node): ANY URL on our own web origin is one of the app's own pages, so it
  // ALWAYS opens in-app through the deep-link resolver (precise nav → section
  // nav → seed into chat) and NEVER bounces through the external browser. A
  // provider URL pointing into a bound resource opens its in-app page; anything
  // else opens externally.
  const openNodeLink = useCallback(
    (url: string) => {
      const trimmed = url.trim()
      const parsed = isAppWebUrl(trimmed)
      const inApp = trimmed.startsWith('/teams/') || parsed !== null

      if (inApp) {
        openAppOpenDeepLink({
          path: parsed ? `${parsed.pathname}${parsed.search}` : trimmed,
          url: parsed ? parsed.toString() : trimmed,
        })

        return
      }
      if (openBoundProviderLinkFromChat(trimmed)) return
      openExternalLink(trimmed)
    },
    [openAppOpenDeepLink, openBoundProviderLinkFromChat, openExternalLink],
  )

  // Chat-link policy: an app URL on our own web origin NEVER bounces to the external
  // browser. Exact navigation when the resolver knows the path; otherwise the
  // deep-link fallback (team tab / seed into chat) still keeps it in-app. A bare
  // file path opens in Files; other web links open in the built-in browser.
  const openNuphosLinkFromChat = useCallback(
    (href: string, beside = false): boolean => {
      if (isBindableGithubLink(href)) return openBrowserLink(href.trim(), beside)
      if (openNuphosLinkInNewTab(href, beside)) return true
      if (beside) return false
      if (openBoundProviderLinkFromChat(href)) return true
      const filePath = runtimeFilePathFromHref(href)

      if (filePath && teamId) {
        return openNuphosLinkInNewTab(
          pageLocationForNavigation(
            emptyNavigation({ kind: 'team', teamId }, 'team.files', { filter: filePath }),
          ).href,
        )
      }
      const parsed = isAppWebUrl(href.trim())

      if (!parsed || !parsed.pathname.startsWith('/teams/')) return openBrowserLink(href.trim())
      openAppOpenDeepLink({
        path: `${parsed.pathname}${parsed.search}`,
        url: parsed.toString(),
      })

      return true
    },
    [
      openAppOpenDeepLink,
      openBoundProviderLinkFromChat,
      openBrowserLink,
      openNuphosLinkInNewTab,
      teamId,
    ],
  )

  // GitHub badges open browser tabs; other providers retain their native pages.
  // ⌘-click is the explicit system-browser escape hatch.
  const openSessionResource = useCallback(
    (url: string, external: boolean) => {
      if (external || !teamId) {
        openExternalLink(url)

        return
      }
      if (isBindableGithubLink(url)) {
        openBrowserLink(url)

        return
      }
      const path =
        appPathForExternalLink(url, teamId, boundResources) ??
        pageLocationForNavigation(
          emptyNavigation({ kind: 'team', teamId }, 'team.browser', { browserUrl: url }),
        ).href

      openNuphosLinkInNewTab(path)
    },
    [boundResources, openBrowserLink, openExternalLink, openNuphosLinkInNewTab, teamId],
  )

  const chatLinkMenuActions = useChatLinkMenuActions({
    teamId,
    copyLink,
    openExternalLink,
    openNuphosLinkFromChat,
    openNuphosLinkInNewTab,
  })

  // Props rooted in `tabs`/`activeTab` churn every poll; one unstable prop
  // re-renders every memoized pane.
  const stableDockAgentToSidebar = useStableCallback(dockAgentToSidebar)
  const stableOpenNuphosLinkFromChat = useStableCallback(openNuphosLinkFromChat)
  const stableOpenNodeLink = useStableCallback(openNodeLink)
  const stableOpenSessionResource = useStableCallback(openSessionResource)
  const stableOpenPlanInChat = useStableCallback(openPlanInChat)
  const stableOpenConversationHere = useStableCallback(openConversationHere)
  const stableEnterCluster = useStableCallback((params: Parameters<typeof enterCluster>[0]) => {
    void enterCluster(params)
  })
  const stableOpenInChat = useStableCallback(openInChat)
  const stableOpenAgentChatWithPrompt = useStableCallback(openAgentChatWithPrompt)

  // Deep links that arrive before this listener exists (cold start, or any
  // moment between remounts) stay queued in the main process and are re-sent
  // until this handler acks one — attaching is all this side has to do.
  useEffect(() => {
    if (paneActive) return api.onAppOpenDeepLink(openAppOpenDeepLink)
  }, [paneActive, openAppOpenDeepLink])

  return {
    chatLinkMenuActions,
    openNuphosLinkFromChat,
    stableDockAgentToSidebar,
    stableOpenNuphosLinkFromChat,
    stableOpenNodeLink,
    stableOpenSessionResource,
    stableOpenPlanInChat,
    stableOpenConversationHere,
    stableEnterCluster,
    stableOpenInChat,
    stableOpenAgentChatWithPrompt,
  }
}

export type WorkspaceChatLinksResult = ReturnType<typeof useWorkspaceChatLinks>
