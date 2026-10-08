import { useCallback, useMemo } from 'react'

import { useRecordDockVisit } from '../../hooks/useDockHistory'
import { pageLocationForNavigation } from '../../lib/appRoutes'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import { navigationSnapshot, pageLocationForTab } from '../workspaceTabFactory'

import { pageMetaIdentityMatches } from './pageMetaIdentity'

import type { NavigationSnapshot } from '../../lib/appRoutes'
import type { RowLinkOverride, WorkspaceRowLinkValue } from '../../lib/workspaceRowLink'
import type { PageMetaInput } from '../pageMetaContext'
import type { WorkspaceTabState } from '../workspaceTabState'
import type { UpdateWorkspaceTab } from './paneTypes'

export function useTabPageMeta({
  tabId,
  userId,
  tab,
  active,
  pageHref,
  updateTab,
  copyLink,
  openInChat,
}: {
  tabId: string
  userId: string
  tab: WorkspaceTabState
  active: boolean
  pageHref: string
  updateTab: UpdateWorkspaceTab
  copyLink: (href: string) => Promise<void>
  openInChat: (href: string) => void
}) {
  // The page meta this hook stores is what the dock history remembers.
  useRecordDockVisit(userId, tab)
  const setPageMeta = useCallback(
    ({ pageKey, title, icon, iconKey, canonicalHref }: PageMetaInput) => {
      updateTab(tabId, (cur) => {
        const location = pageLocationForTab(cur)

        if (location.href !== canonicalHref) {
          return cur
        }
        const current = cur.pageMeta

        if (
          pageMetaIdentityMatches(current, { pageKey, title, iconKey, locationHref: location.href })
        ) {
          return cur
        }

        return {
          ...cur,
          pageMeta: {
            key: pageKey,
            title,
            icon,
            iconKey,
            location,
          },
        }
      })
    },
    [tabId, updateTab],
  )
  const pageMetaContext = useMemo(
    () => ({ canonicalHref: pageHref, setPageMeta }),
    [pageHref, setPageMeta],
  )

  const rowLinkValue = useMemo<WorkspaceRowLinkValue>(() => {
    const base = navigationSnapshot(tab)

    return {
      linkForRow: (override: RowLinkOverride) => {
        // Explicit path bypasses the snapshot pipeline — used when a view
        // already knows its own clean sub-path (e.g. ".../ec2-instances/<id>").
        if (typeof override.path === 'string') {
          return toAbsoluteAtlasUrl(override.path)
        }
        // Otherwise overlay onto the current snapshot.
        const merged: NavigationSnapshot = {
          ...base,
          ...(override as Partial<NavigationSnapshot>),
        }
        const location = pageLocationForNavigation(merged, tab)

        return toAbsoluteAtlasUrl(location.href)
      },
      copyLink,
      openInChat,
    }
  }, [tab, copyLink, openInChat])

  const workspaceTabContextValue = useMemo(
    () => ({
      tabId,
      refreshKey: tab.refreshKey,
      pollTick: tab.pollTick,
      isActive: active,
    }),
    [tabId, tab.refreshKey, tab.pollTick, active],
  )

  return { setPageMeta, pageMetaContext, rowLinkValue, workspaceTabContextValue }
}
