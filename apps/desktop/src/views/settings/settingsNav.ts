import {
  Archive,
  Brain,
  CircleUserRound,
  Clock,
  CreditCard,
  Download,
  FileText,
  KeyRound,
  LifeBuoy,
  Monitor,
  MonitorSmartphone,
  NotebookPen,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  SunMedium,
  Users,
} from 'lucide-react'

import { t } from '../../i18n/index.ts'

import type { LucideIcon } from 'lucide-react'

export type SettingsScope = 'user' | 'team'

export type SettingsNavItem = {
  key: string
  label: string
  icon: LucideIcon
}

export type SettingsNavGroup = {
  title: string
  items: SettingsNavItem[]
}

export const USER_SETTINGS_DEFAULT_SECTION = 'account.profile'
export const TEAM_SETTINGS_DEFAULT_SECTION = 'workspace.general'
export const MY_PREFERENCES_DEFAULT_SECTION = 'preferences.instructions'

/** Team pages that live in Settings, by the workspace page key their links resolve to. */
const SETTINGS_SECTION_FOR_PAGE: Partial<Record<string, string>> = {
  'team.agent-skills': 'workspace.skills',
  'team.agent-memories': 'workspace.memories',
  'team.triggers': 'workspace.triggers',
  'team.schedule': 'workspace.triggers',
}

export function settingsSectionForPage(key: string): string | undefined {
  return SETTINGS_SECTION_FOR_PAGE[key]
}

/**
 * Where a link to a page hosted in Settings lands: the section, its search, and
 * the team whose Settings it opens. Undefined when the page is not in Settings;
 * null when the link names a team the viewer is not in, so nothing opens.
 */
export function settingsLinkTarget(
  navigation: { active: string; scope: { teamId: string }; filter?: string },
  teamIds: readonly string[],
): { section: string; filter?: string; teamId: string } | null | undefined {
  const section = settingsSectionForPage(navigation.active)

  if (!section) return undefined
  const { teamId } = navigation.scope

  return teamIds.includes(teamId) ? { section, filter: navigation.filter, teamId } : null
}

const TEAM_GROUPS: SettingsNavGroup[] = [
  {
    title: t('Team'),
    items: [
      { key: 'workspace.general', label: t('General'), icon: Settings },
      { key: 'workspace.members', label: t('Members'), icon: Users },
      { key: 'workspace.billing', label: t('Billing'), icon: CreditCard },
      { key: 'workspace.instructions', label: t('Instructions'), icon: FileText },
      { key: 'workspace.skills', label: t('Skills'), icon: Sparkles },
      { key: 'workspace.memories', label: t('Memories'), icon: Brain },
      { key: 'workspace.triggers', label: t('Triggers'), icon: Clock },
      { key: 'workspace.archived', label: t('Archived agents'), icon: Archive },
      { key: 'workspace.audit', label: t('Audit log'), icon: ScrollText },
    ],
  },
  {
    title: t('My preferences'),
    items: [
      { key: 'preferences.instructions', label: t('Personal instructions'), icon: NotebookPen },
      { key: 'preferences.localSetup', label: t('Sync my setup'), icon: RefreshCw },
      { key: 'preferences.runtimeFallback', label: t('Agent fallback'), icon: LifeBuoy },
    ],
  },
]

const USER_GROUPS: SettingsNavGroup[] = [
  {
    title: t('Account'),
    items: [
      { key: 'account.profile', label: t('Profile'), icon: CircleUserRound },
      { key: 'account.personalCredentials', label: t('Personal Credentials'), icon: KeyRound },
      { key: 'account.devices', label: t('Signed-in devices'), icon: MonitorSmartphone },
    ],
  },
  {
    title: t('This computer'),
    items: [
      { key: 'device.appearance', label: t('Appearance'), icon: SunMedium },
      { key: 'device.updates', label: t('Updates'), icon: Download },
      { key: 'device.localExec', label: t('Local exec'), icon: SquareTerminal },
      { key: 'device.localRuntime', label: t('Local runtime'), icon: Monitor },
      { key: 'device.privacy', label: t('Privacy'), icon: ShieldCheck },
    ],
  },
]

export function settingsScopeOf(section: string): SettingsScope {
  return section.startsWith('account.') || section.startsWith('device.') ? 'user' : 'team'
}

export function settingsNavGroups(scope: SettingsScope): SettingsNavGroup[] {
  return scope === 'user' ? USER_GROUPS : TEAM_GROUPS
}

export function filterSettingsNavGroups(
  groups: SettingsNavGroup[],
  query: string,
): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase()

  if (!needle) return groups

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.items.length > 0)
}
