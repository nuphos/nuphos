import { Cloud, Compass, MessageSquare, Star } from 'lucide-react'

import { navigationFromAppPath } from '../../lib/appRoutes'
import { HREF_FAVORITE_PREFIX } from '../../lib/sidebarFavorites'
import { teamOverviewNavItemFor } from '../../lib/teamOverviewNav'

import type { Scope, TeamInvitation, UserInfo } from '../../types'
import type { BreadcrumbSegment } from '../Toolbar'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type Item = {
  key: string
  label: string
  icon?: LucideIcon
  iconNode?: ReactNode
  enabled: boolean
  active?: boolean
  /** Optional count to render as a small badge to the right of the label. */
  badge?: number
  /** Status content preserved when the item is pinned. */
  trailing?: ReactNode
  /** Row actions omitted from pinned favorites. */
  actions?: ReactNode
  /** Overrides the default onSelect(key) click behavior (Favorites rows).
   *  `newTab` is true for a cmd/ctrl-click. */
  onActivate?: (newTab: boolean) => void
  /**
   * The app path this row leads to, when it has one. Rows that carry it pin as
   * href favorites, which is the same identity a workspace tab produces — so
   * starring a chat here and starring its tab can't create two entries.
   */
  href?: string
  /**
   * A chat row the viewer does not own (the Shared section). Renaming and
   * archiving belong to the owner — the backend scopes both to them — so the
   * row's menu offers neither. Pinning still works: that is the viewer's own.
   */
  readOnlyChat?: boolean
}

export type Section = {
  /**
   * Omitted for the top nav, which is the whole app rather than a category
   * within it — a heading there would promise a sibling category that doesn't
   * exist. A title-less section renders no header and can't be collapsed.
   */
  title?: string
  items: Item[]
  loading?: boolean
  /** Default for a group with no persisted user preference. */
  defaultCollapsed?: boolean
}

export function isTeamIntegrationsActive(active: string): boolean {
  return active === 'team.integrations' || active === 'team.accounts'
}

export function isSettingsNavigation(scope: Scope, active: string): boolean {
  if (scope.kind === 'team') {
    return false
  }
  if (scope.kind === 'aws-account') {
    return active === 'aws.roles' || active === 'aws.role'
  }
  if (scope.kind === 'azure-subscription') {
    return active === 'azure.apps'
  }
  if (scope.kind === 'gcp-project') {
    return (
      active === 'gcp.service-accounts' || active === 'gcp.service-account' || active === 'gcp.iam'
    )
  }
  if (scope.kind === 'cloudflare-account') {
    return active === 'cloudflare.iam'
  }

  return false
}

export function settingsBackTarget(scope: Scope, active: string): string | null {
  if (!isSettingsNavigation(scope, active)) return null
  if (scope.kind === 'aws-account' && active === 'aws.role') return 'aws.roles'
  if (scope.kind === 'gcp-project' && active === 'gcp.service-account') {
    return 'gcp.service-accounts'
  }
  if (scope.kind === 'team') return 'team.agent'

  return 'team.integrations'
}

export function isIntegrationSettingsNavigation(scope: Scope, active: string): boolean {
  if (scope.kind === 'team') return isTeamIntegrationsActive(active)

  return isSettingsNavigation(scope, active)
}

export function isSidebarItemActive(scope: Scope, active: string, key: string): boolean {
  if (active === key) return true

  return (
    key === 'team.integrations' &&
    (active === 'team.accounts' || isIntegrationSettingsNavigation(scope, active))
  )
}

export function favoriteFallbackIcon(identity: string, href?: string): LucideIcon {
  if (identity.startsWith('agent-session:')) return MessageSquare
  if (identity.startsWith('integration:')) return Cloud
  if (href) {
    // An href favorite that lands on an Overview page borrows that page's own
    // icon, so a pinned Skills page reads as Skills. Substring-matching the
    // path used to mislabel every /agent/* page as a chat.
    const active = navigationFromAppPath(href)?.active
    const overview = active ? teamOverviewNavItemFor(active) : undefined

    if (overview) return overview.icon
  }
  if (identity.startsWith(HREF_FAVORITE_PREFIX)) return Compass

  return Star
}

export type SidebarProps = {
  scope: Scope
  active: string
  /** The conversation open on the agent page, for highlighting its Chats row. */
  agentSessionId?: string | null
  /** False while a management page replaces the chat surface. */
  chatShown?: boolean
  /** A chat was archived from the Chats section; tabs showing it should go. */
  onChatArchived?: (sessionId: string) => void
  /** The active tab's current app path, for highlighting href favorites. */
  currentHref?: string | null
  onSelect: (key: string) => void
  /** Activate an app path captured from a workspace tab (href favorites). The
   *  label is the name the Favorites row shows, which the tab adopts. */
  onOpenPath?: (href: string, label: string, newTab: boolean) => void
  /** Activate a sidebar key. `newTab` opens it beside the current page instead
   *  of replacing it; `favoriteLabel` renames the tab when the click came from
   *  a Favorites row, and is null for an ordinary row. */
  onOpenKey?: (key: string, favoriteLabel: string | null, newTab: boolean) => void
  /**
   * The account/instance an app path belongs to, as a logo plus its name.
   * A page name alone ("Monitors") can't say which service it came from, so
   * Favorites qualify their rows with it. Resolved by the caller, which owns
   * the account data.
   */
  scopeChipForPath?: (href: string) => { label: string; icon: ReactNode } | null
  /** Resolved kubeconfig context for the active cluster tab. */
  kubeconfigContext?: string | null
  user: UserInfo | null
  onLogout: () => void
  grafanaInstance?: { id: string; name: string; url: string } | null
  teamSegment?: BreadcrumbSegment
  /** Pulse a placeholder in the team-switcher slot while teams are loading. */
  teamSkeleton?: boolean
  identitySegment?: BreadcrumbSegment
  repositoryNav?: {
    repoName: string
    tab: 'prs' | 'actions'
  }
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
  /** Go up one navigation level (parent scope). Absent at the team root. */
  onSidebarBack?: () => void
  /** Full breadcrumb path (team → … → current); rendered as the back hover tree. */
  hierarchy?: BreadcrumbSegment[]
  onOpenSettings?: () => void
  onOpenMyPreferences?: () => void
  onOpenUserSettings?: () => void
  /** Open the ⌘/ keyboard-shortcuts cheat sheet. */
  onOpenShortcutsHelp?: () => void
  onCreateTeam?: () => void
  pendingInvitations?: TeamInvitation[]
  /** Return value ignored here (onboarding uses the resolved team id). */
  onAcceptInvitation?: (invitationId: string) => Promise<unknown>
  onRejectInvitation?: (invitationId: string) => Promise<void>
  rootIntegrations?: Item[]
  rootIntegrationsLoading?: boolean
  /** Whether the team already has a Slack workspace bound. */
  slackConnected?: boolean
  /** Start the Slack install flow (shown by the post-onboarding promo card). */
  onConnectSlack?: () => void
  /** True while the new-workspace confetti celebration is playing; the
   *  onboarding checklist choreographs its collapsed→expanded reveal to it. */
  celebrating?: boolean
  /** Whether the sidebar is collapsed to zero width. */
  collapsed?: boolean
  /** Toggle the collapsed state from the titlebar button. */
  onToggleCollapse?: () => void
  /** Restore scope-specific resource navigation while the workspace is expanded. */
  dynamicNavigation?: boolean
}
