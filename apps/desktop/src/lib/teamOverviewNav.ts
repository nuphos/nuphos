import {
  Bot,
  FolderOpen,
  Archive,
  SquarePen,
  Brain,
  ChartLine,
  ClipboardList,
  Clock,
  Cloud,
  HeartPulse,
  Globe,
  Inbox,
  Monitor,
  Terminal,
  Network,
  Sparkles,
} from 'lucide-react'

import { t } from '../i18n/index.ts'

import type { LucideIcon } from 'lucide-react'

export type TeamOverviewNavItem = {
  key: string
  label: string
  icon: LucideIcon
}

/** Keyboard shortcut hinted in a sidebar row's hover tooltip, by nav key. */
export const SIDEBAR_ITEM_SHORTCUTS: Partial<Record<string, string>> = {
  'team.agent': 'mod+n',
}

const NEW_CHAT_NAV_ITEM: TeamOverviewNavItem = {
  key: 'team.agent',
  label: t('New agent'),
  icon: SquarePen,
}

/** Team-wide pages that replace the chat surface when opened from the sidebar. */
export const TEAM_MANAGEMENT_NAV_ITEMS: TeamOverviewNavItem[] = [
  { key: 'team.inbox', label: t('Inbox'), icon: Inbox },
  { key: 'team.agents', label: t('Runtimes'), icon: Bot },
  { key: 'team.integrations', label: t('Connectors'), icon: Cloud },
]

/** Team pages hosted in Team Settings. Their keys still name them in links and ⌘K. */
export const TEAM_SETTINGS_PAGE_NAV_ITEMS: TeamOverviewNavItem[] = [
  { key: 'team.agent-skills', label: t('Skills'), icon: Sparkles },
  { key: 'team.agent-memories', label: t('Memories'), icon: Brain },
  { key: 'team.triggers', label: t('Triggers'), icon: Clock },
]

/** Opened from the foot of the sidebar's Chats list, not from the nav rows. */
export const ARCHIVED_CHATS_NAV_ITEM: TeamOverviewNavItem = {
  key: 'team.archived-chats',
  label: t('Archived agents'),
  icon: Archive,
}

const MAIN_PANE_NAV_ITEMS = [...TEAM_MANAGEMENT_NAV_ITEMS, ARCHIVED_CHATS_NAV_ITEM]

/** Pages read beside a conversation, launched from the dock's New Tab page. */
export const TEAM_WORKSPACE_NAV_ITEMS: TeamOverviewNavItem[] = [
  { key: 'team.browser', label: t('Browser'), icon: Globe },
  { key: 'team.files', label: t('Files'), icon: FolderOpen },
  { key: 'team.terminal', label: t('Terminal'), icon: Terminal },
  { key: 'team.plans', label: t('Plans'), icon: ClipboardList },
  { key: 'team.architecture', label: t('Architecture'), icon: Network },
  { key: 'team.dashboards', label: t('Dashboards'), icon: ChartLine },
  { key: 'team.monitoring', label: t('Monitoring'), icon: HeartPulse },
]

/** The sidebar's untitled top section: the chat entry plus the management pages. */
export const TEAM_SIDEBAR_NAV_ITEMS: TeamOverviewNavItem[] = [
  NEW_CHAT_NAV_ITEM,
  ...TEAM_MANAGEMENT_NAV_ITEMS,
]

/**
 * Legacy keys that still reach a live page resolve to its nav item rather than
 * falling off the list: `team.accounts` opens Connectors, and `team.schedule`
 * opens Triggers.
 */
const TEAM_OVERVIEW_KEY_ALIASES: Record<string, string> = {
  'team.accounts': 'team.integrations',
  'team.schedule': 'team.triggers',
}

/** A renamed page's key as stored by an older build (saved tabs, favorites),
 *  mapped to its current key. */
const RENAMED_TEAM_NAV_KEYS: Record<string, string> = {
  'team.calendar': 'team.schedule',
  'team.cost-management': 'team.dashboards',
  'team.linear-issue': 'team.linear',
}

export function renamedTeamNavKey(key: string): string {
  return RENAMED_TEAM_NAV_KEYS[key] ?? key
}

/** The same rename for a stored in-app path. */
export function renamedTeamPagePath(path: string): string {
  return path.replace(/^(\/teams\/[^/?#]+)\/cost-management(?=[/?#]|$)/u, '$1/dashboards')
}

export function canonicalTeamOverviewKey(active: string): string {
  return TEAM_OVERVIEW_KEY_ALIASES[active] ?? active
}

function navItemIn(
  items: readonly TeamOverviewNavItem[],
  active: string,
): TeamOverviewNavItem | undefined {
  const key = canonicalTeamOverviewKey(active)

  return items.find((item) => item.key === key)
}

export function teamOverviewNavItemFor(active: string): TeamOverviewNavItem | undefined {
  if (active === 'team.desktop') return { key: active, label: t('Desktop'), icon: Monitor }

  return (
    navItemIn(TEAM_SIDEBAR_NAV_ITEMS, active) ??
    navItemIn(TEAM_WORKSPACE_NAV_ITEMS, active) ??
    navItemIn(TEAM_SETTINGS_PAGE_NAV_ITEMS, active) ??
    navItemIn([ARCHIVED_CHATS_NAV_ITEM], active)
  )
}

export function isTeamManagementKey(active: string): boolean {
  return Boolean(navItemIn(MAIN_PANE_NAV_ITEMS, active))
}

export function isTeamWorkspaceKey(active: string): boolean {
  return active === 'team.desktop' || Boolean(navItemIn(TEAM_WORKSPACE_NAV_ITEMS, active))
}

export function isTeamOverviewKey(active: string): boolean {
  return Boolean(teamOverviewNavItemFor(active))
}
