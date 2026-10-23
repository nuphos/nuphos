import { ArrowLeftRight, Keyboard, PanelLeft, Plus, Settings, SquarePen, Users } from 'lucide-react'

import { launcherMatchRank } from '../../lib/launcherMatch.ts'
import { SHORTCUT_GROUPS } from '../../lib/shortcutsCatalog.ts'
import {
  ARCHIVED_CHATS_NAV_ITEM,
  TEAM_MANAGEMENT_NAV_ITEMS,
  TEAM_SETTINGS_PAGE_NAV_ITEMS,
} from '../../lib/teamOverviewNav.ts'

import type { AppShortcutAction } from '../../api/window-shell'
import type { LucideIcon } from 'lucide-react'

export type PaletteAction = Extract<
  AppShortcutAction,
  | 'new-chat'
  | 'new-tab'
  | 'toggle-sidebar'
  | 'open-settings'
  | 'open-team-settings'
  | 'shortcuts-help'
>

/** A page (its sidebar nav key) or an app action the ⌘K dialog can run. */
export type PaletteCommand = {
  id: string
  label: string
  group: 'Go to' | 'Actions'
  icon: LucideIcon
  combo?: string
}

const ACTIONS: { id: PaletteAction; label: string; icon: LucideIcon }[] = [
  { id: 'new-chat', label: 'New agent', icon: SquarePen },
  { id: 'new-tab', label: 'New tab', icon: Plus },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', icon: PanelLeft },
  { id: 'open-settings', label: 'User settings', icon: Settings },
  { id: 'open-team-settings', label: 'Team settings', icon: Users },
  { id: 'shortcuts-help', label: 'Keyboard shortcuts', icon: Keyboard },
]

const comboFor = (label: string) =>
  SHORTCUT_GROUPS.flatMap((group) => group.entries).find((entry) => entry.label === label)
    ?.combos[0]

export const PALETTE_COMMANDS: PaletteCommand[] = [
  ...[...TEAM_MANAGEMENT_NAV_ITEMS, ...TEAM_SETTINGS_PAGE_NAV_ITEMS, ARCHIVED_CHATS_NAV_ITEM].map(
    (item) => ({
      id: item.key,
      label: item.label,
      group: 'Go to' as const,
      icon: item.icon,
    }),
  ),
  ...ACTIONS.map((action) => ({
    ...action,
    group: 'Actions' as const,
    combo: comboFor(action.label),
  })),
]

/** The palette id that switches to a team; usePaletteCommand reads it back. */
export const SWITCH_TEAM_PREFIX = 'switch-team:'

/** Commands whose name matches, best match first (as in the dock's New Tab);
 *  none for an empty query, so recents stay on top. Other teams join as
 *  "Switch to …" actions. */
export function matchPaletteCommands(
  query: string,
  otherTeams: { id: string; name: string }[] = [],
): PaletteCommand[] {
  if (!query.trim()) return []
  const teamCommands = otherTeams.map((team) => ({
    id: `${SWITCH_TEAM_PREFIX}${team.id}`,
    label: `Switch to ${team.name}`,
    group: 'Actions' as const,
    icon: ArrowLeftRight,
  }))

  return [...PALETTE_COMMANDS, ...teamCommands]
    .map((command) => ({
      command,
      rank: launcherMatchRank(command.label, query),
    }))
    .filter((match): match is { command: PaletteCommand; rank: number } => match.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map(({ command }) => command)
}
