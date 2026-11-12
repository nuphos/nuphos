import type { Item, Section } from './types'

export type ConversationMode = 1 | 2

export function modeItems(sections: Section[], mode: ConversationMode): Item[] {
  const items = sections
    .flatMap((section) =>
      section.title === (mode === 1 ? 'Channels' : 'Tasks') ? section.items : [],
    )
    .filter((item) => item.enabled && (mode === 1 || (item.task && !item.bot)))

  return mode === 1
    ? items
    : [
        ...items.filter((item) => item.taskState === 'attention'),
        ...items.filter((item) => item.taskState === 'working'),
        ...items.filter((item) => item.taskState !== 'attention' && item.taskState !== 'working'),
      ]
}

const key = (teamId: string, mode: ConversationMode) => `nuphos.sidebar.selection.${teamId}.${mode}`

export function readModeSelection(teamId: string, mode: ConversationMode): string | null {
  try {
    return localStorage.getItem(key(teamId, mode))
  } catch {
    return null
  }
}
export function rememberModeSelection(teamId: string, mode: ConversationMode, item: Item): void {
  try {
    localStorage.setItem(key(teamId, mode), item.key)
  } catch {
    /* Storage is optional. */
  }
}
export function restoreModeItem(items: Item[], remembered: string | null): Item | undefined {
  return items.find((item) => item.key === remembered) ?? items[0]
}
