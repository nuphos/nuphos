import { useCallback, useMemo, useState } from 'react'

import { LINEAR_PAGE_KEY } from '../../lib/linearNav'
import { planNumberFromFilter } from '../../lib/planRoute'

import { computeIdentitySegment } from './identitySegment'
import { computeRootIntegrations } from './rootIntegrations'

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
import type { WorkspaceProps } from './workspaceProps'
import type { BreadcrumbSegment } from '../../components/Toolbar'
import type { ToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import type { LinearNavState } from '../../lib/app-routes/types'
import type { GithubNavState } from '../../views/GithubView'

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
  WorkspaceBreadcrumbResult

function isGithubPullDetail(active: string, githubNav: GithubNavState): boolean {
  return active === 'team.repository' && githubNav.view === 'pull'
}

function isLinearIssueDetail(active: string, linearNav: LinearNavState | null): boolean {
  return active === LINEAR_PAGE_KEY && linearNav?.view === 'issue'
}

const UNFILTERABLE_PAGE_KEYS = new Set([
  'team.new-tab',
  'team.browser',
  'team.terminal',
  'team.agent',
  // Cloudflare IAM is a status panel: summary card, warnings and granted-scope
  // chips, with no list to filter.
  'cloudflare.iam',
  // Connectors owns a catalog search below its title and copy.
  'team.integrations',
])

export function useWorkspaceToolbar(a: Args) {
  const {
    databaseConnectionsByTeam,
    grafanaInstancesByTeam,
    githubInstallationsByTeam,
    gitlabNamespacesByTeam,
    scope,
    active,
    filter,
    target,
    architectureDetail,
    triggerForm,
    nuphosDashboard,
    connectorDetail,
    awsDetail,
    sshTerminal,
    githubNav,
    linearNav,
    updateActiveTab,
    teamId,
    accounts,
    breadcrumb,
  } = a

  const rootIntegrations = useMemo(
    () =>
      computeRootIntegrations({
        teamId,
        accounts,
        databaseConnectionsByTeam,
        grafanaInstancesByTeam,
        githubInstallationsByTeam,
        gitlabNamespacesByTeam,
      }),
    [
      accounts,
      teamId,
      databaseConnectionsByTeam,
      grafanaInstancesByTeam,
      githubInstallationsByTeam,
      gitlabNamespacesByTeam,
    ],
  )
  const identitySegment = useMemo<BreadcrumbSegment | undefined>(
    () => computeIdentitySegment({ scope, accounts, active, updateActiveTab }),
    [accounts, active, scope, updateActiveTab],
  )
  // The team picker belongs to the persistent left rail. The workspace header
  // starts directly at the current page; it no longer needs a redundant Home.
  const toolbarSegments = breadcrumb.slice(1)
  // The alarm drill-down has no filterable list (lambda/log-group details do —
  // their Logs tabs consume the filter), so hide the stale list controls there.
  const inAlarmDetail = active === 'aws.cloudwatch-alarms' && awsDetail?.kind === 'alarm'
  const inPlanDetail = active === 'team.plans' && Boolean(planNumberFromFilter(filter))
  // Pages whose body is not a filterable list — a search box there would type
  // into nothing. Everything else inside a scope gets the shared filter, the
  // settings-nav lists (bound roles / apps / service accounts) included: they
  // all ship working filter logic, it just used to be unreachable.
  const isUnfilterablePage =
    // PR detail has its own title, state and tabs; search/filter controls do
    // not operate on its conversation or diff and only add a dead second row.
    isGithubPullDetail(active, githubNav) ||
    isLinearIssueDetail(active, linearNav) ||
    UNFILTERABLE_PAGE_KEYS.has(active)
  const showListControls =
    Boolean(scope) &&
    !target &&
    !sshTerminal &&
    !inAlarmDetail &&
    !inPlanDetail &&
    !architectureDetail &&
    // A Triggers form filters nothing — the search box and count belong to
    // the list it replaced.
    !triggerForm &&
    // The connector drill-down swaps the table out for a provider info page.
    !connectorDetail &&
    // The dashboard list page is a filterable list; an open dashboard is not.
    !nuphosDashboard &&
    !isUnfilterablePage
  // The search box refines the page rather than leaving it, so it rewrites the
  // current history entry (a few pages encode the filter into their URL) —
  // Back must exit the page, not replay keystrokes.
  const setActiveFilter = useCallback(
    (nextFilter: string) => {
      updateActiveTab((tab) => ({ ...tab, filter: nextFilter }), { history: 'replace' })
    },
    [updateActiveTab],
  )
  // The active list view publishes its primary action (e.g. "Create bucket")
  // here so it renders on the toolbar's filter row instead of a separate
  // per-view bar. Cleared automatically when that view unmounts/deactivates.
  const [toolbarPrimaryAction, setToolbarPrimaryAction] = useState<ToolbarPrimaryAction | null>(
    null,
  )
  // Always-present portal targets on the toolbar's controls row: a left region
  // (next to search — filters/tabs/pickers) and a right region (actions). Any
  // active view renders its own controls into them via useToolbarSlot(); the
  // occupancy flags let the row appear for those views without App special-
  // casing which pages carry their own controls.
  const [toolbarLeftEl, setToolbarLeftEl] = useState<HTMLElement | null>(null)
  const [toolbarRightEl, setToolbarRightEl] = useState<HTMLElement | null>(null)
  const [toolbarHeaderRightEl, setToolbarHeaderRightEl] = useState<HTMLElement | null>(null)
  const [toolbarLeftOccupied, setToolbarLeftOccupied] = useState(false)
  const [toolbarRightOccupied, setToolbarRightOccupied] = useState(false)
  const [toolbarHeaderRightOccupied, setToolbarHeaderRightOccupied] = useState(false)
  const setToolbarSlotOccupied = useCallback((side: 'left' | 'right', occupied: boolean) => {
    ;(side === 'left' ? setToolbarLeftOccupied : setToolbarRightOccupied)(occupied)
  }, [])
  const toolbarSlots = useMemo(
    () => ({
      left: toolbarLeftEl,
      right: toolbarRightEl,
      headerRight: toolbarHeaderRightEl,
      setOccupied: setToolbarSlotOccupied,
      setHeaderRightOccupied: setToolbarHeaderRightOccupied,
    }),
    [toolbarLeftEl, toolbarRightEl, toolbarHeaderRightEl, setToolbarSlotOccupied],
  )

  return {
    rootIntegrations,
    identitySegment,
    toolbarSegments,
    showListControls,
    setActiveFilter,
    toolbarPrimaryAction,
    setToolbarPrimaryAction,
    setToolbarLeftEl,
    setToolbarRightEl,
    setToolbarHeaderRightEl,
    toolbarHeaderRightOccupied,
    toolbarLeftOccupied,
    toolbarRightOccupied,
    toolbarSlots,
  }
}

export type WorkspaceToolbarResult = ReturnType<typeof useWorkspaceToolbar>
