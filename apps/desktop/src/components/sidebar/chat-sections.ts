import type { Item, Section } from './types'

/**
 * Sessions the viewer joined but does not own. Its own function because the
 * favorites resolver needs the same section to look a pinned row up among the
 * live ones — a pin that cannot find itself there renders a static icon instead
 * of the live runtime one.
 */
export function sharedChatSection(sharedChatItems: Item[]): Section[] {
  return sharedChatItems.length > 0 ? [{ title: 'Shared', items: sharedChatItems }] : []
}

/**
 * The chat groups in team view: what the viewer pinned, then the sessions they
 * joined, both above their own Chats. A thread goes wherever the row it nests
 * under goes, so a pinned or shared conversation keeps its threads exactly as
 * Chats would show them; a pinned thread takes its own threads to Pinned. No
 * chat is listed twice, and an empty group contributes no section at all.
 */
export function withChatSections(
  sections: Section[],
  pinnedChatItems: Item[],
  sharedChatItems: Item[],
  isPinned: (item: Item) => unknown,
): Section[] {
  const chatItems = sections.find((section) => section.title === 'Chats')?.items ?? []
  const shared = new Set(sharedChatItems.map((item) => item.key))
  const byKey = new Map([...sharedChatItems, ...chatItems].map((item) => [item.key, item]))
  const live = [...byKey.values()]
  const groupOf = (item: Item, seen = new Set<string>()): string => {
    if (isPinned(item)) return 'Pinned'
    const parent = item.parentKey ? byKey.get(item.parentKey) : undefined

    if (parent && !seen.has(item.key)) return groupOf(parent, seen.add(item.key))

    return shared.has(item.key) ? 'Shared' : 'Chats'
  }
  const group = (title: string) => live.filter((item) => !isPinned(item) && groupOf(item) === title)
  const groups = [
    { title: 'Pinned', items: [...pinnedChatItems, ...group('Pinned')] },
    { title: 'Shared', items: group('Shared') },
  ].filter(({ items }) => items.length > 0)
  const result = sections.flatMap((section) => {
    if (section.title !== 'Chats') return [section]
    const items = group('Chats')

    return items.length > 0 ? [{ ...section, items }] : []
  })
  const chatsIndex = result.findIndex((section) => section.title === 'Chats')

  result.splice(chatsIndex === -1 ? 1 : chatsIndex, 0, ...groups)

  return result
}
