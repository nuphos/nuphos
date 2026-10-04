import {
  Archive,
  CircleUserRound,
  FileText,
  Monitor,
  NotebookPen,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareTerminal,
  SunMedium,
  Users,
} from 'lucide-react'

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

const TEAM_GROUPS: SettingsNavGroup[] = [
  {
    title: 'Team',
    items: [
      { key: 'workspace.general', label: 'General', icon: Settings },
      { key: 'workspace.members', label: 'Members', icon: Users },
      { key: 'workspace.instructions', label: 'Instructions', icon: FileText },
      { key: 'workspace.archived', label: 'Archived chats', icon: Archive },
      { key: 'workspace.audit', label: 'Audit log', icon: ScrollText },
    ],
  },
  {
    title: 'My preferences',
    items: [{ key: 'preferences.instructions', label: 'Personal instructions', icon: NotebookPen }],
  },
]

const USER_GROUPS: SettingsNavGroup[] = [
  {
    title: 'Account',
    items: [
      { key: 'account.profile', label: 'Profile', icon: CircleUserRound },
      { key: 'account.autoMode', label: 'Auto-authorization', icon: ShieldCheck },
    ],
  },
  {
    title: 'This computer',
    items: [
      { key: 'device.appearance', label: 'Appearance', icon: SunMedium },
      { key: 'device.localExec', label: 'Local exec', icon: SquareTerminal },
      { key: 'device.localRuntime', label: 'Local agent', icon: Monitor },
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
