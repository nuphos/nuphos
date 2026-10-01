import { useCallback, useEffect, useRef } from 'react'

import { api } from '../../api'

import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult

export function useWorkspaceNamespaces(a: Args) {
  const { activeTabId, activeTab, updateTab } = a

  // K8s namespaces (only when in cluster scope). Deliberately NOT fetched here:
  // the list is unbounded and can take minutes on a large cluster, which used
  // to stall the toolbar on every cluster entry. This effect only clears stale
  // names; `loadNamespaces` fills them in when the picker is first opened.
  const activeKubeContext = activeTab?.kubeconfigContext ?? null
  // Fetches already started, keyed by tab AND context. Per-tab because the
  // fetched names live in tab state: a context-only key would let a second tab
  // on the same cluster be deduped against the first tab's fetch and then sit
  // empty forever.
  const namespaceFetchStarted = useRef(new Set<string>())
  const namespaceFetchKey =
    activeTabId && activeKubeContext ? `${activeTabId}\x1f${activeKubeContext}` : null

  // Drop a tab's namespace list when its cluster changes. Deliberately NOT
  // keyed on `refreshKey`: that is bumped on tab activation and on every
  // namespace pick, and re-fetching a 500-of-39,228 page each time is seconds
  // of latency for a list that did not change. Explicit Refresh invalidates it
  // through `invalidateNamespaces` instead.
  const invalidateNamespaces = useCallback(
    (tabId: string) => {
      for (const key of namespaceFetchStarted.current) {
        if (key.startsWith(`${tabId}\x1f`)) namespaceFetchStarted.current.delete(key)
      }
      updateTab(tabId, (tab) =>
        tab.namespaces.length > 0 || tab.namespacesState
          ? {
              ...tab,
              namespaces: [],
              namespacesState: undefined,
              namespacesTruncated: undefined,
              namespacesTotal: undefined,
            }
          : tab,
      )
    },
    [updateTab],
  )

  useEffect(() => {
    if (!activeTabId) return
    invalidateNamespaces(activeTabId)
  }, [activeTabId, activeKubeContext, invalidateNamespaces])

  const loadNamespaces = useCallback(() => {
    const tabId = activeTabId

    if (!tabId || !activeKubeContext || !namespaceFetchKey) return
    if (namespaceFetchStarted.current.has(namespaceFetchKey)) return
    namespaceFetchStarted.current.add(namespaceFetchKey)
    updateTab(tabId, (tab) => ({ ...tab, namespacesState: 'loading' }))
    api
      .listNamespaceNames(activeKubeContext)
      .then(({ names, truncated, total }) => {
        updateTab(tabId, (tab) =>
          // Guard against a context switch mid-flight handing this tab the
          // previous cluster's namespaces.
          tab.kubeconfigContext === activeKubeContext
            ? {
                ...tab,
                namespaces: names,
                namespacesTruncated: truncated,
                namespacesTotal: total,
                namespacesState: 'loaded',
              }
            : tab,
        )
      })
      .catch(() => {
        // Back to idle so opening the picker again retries — but only if this
        // tab is still on the context we fetched for, or we would clobber a
        // newer context's already-loaded state.
        namespaceFetchStarted.current.delete(namespaceFetchKey)
        updateTab(tabId, (tab) =>
          tab.kubeconfigContext === activeKubeContext
            ? { ...tab, namespacesState: undefined }
            : tab,
        )
      })
  }, [activeTabId, activeKubeContext, namespaceFetchKey, updateTab])

  return {
    activeKubeContext,
    invalidateNamespaces,
    loadNamespaces,
  }
}

export type WorkspaceNamespacesResult = ReturnType<typeof useWorkspaceNamespaces>
