import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/**
 * The chat groups in team view: what the viewer pinned, above their own Chats.
 * A thread goes wherever the row it nests under goes, so a pinned conversation
 * keeps its threads exactly as Chats would show them; a pinned thread takes its
 * own threads to Pinned. Pinned only holds chats the chat list still has, so
 * an archived chat leaves Pinned with its row and is back when it is restored.
 * No chat is listed twice, and an empty group contributes no section at all.
 */
export function withChatSections(
  sections: Section[],
  pinnedChatItems: Item[],
  isPinned: (item: Item) => unknown,
): Section[] {
  const chatItems = sections.find((section) => section.title === 'Agents')?.items ?? []
  const byKey = new Map(chatItems.map((item) => [item.key, item]))
  const inPinned = (item: Item, seen = new Set<string>()): boolean => {
    if (isPinned(item)) return true
    const parent = item.parentKey ? byKey.get(item.parentKey) : undefined

    return Boolean(parent && !seen.has(item.key) && inPinned(parent, seen.add(item.key)))
  }
  const pinned = [
    ...pinnedChatItems.filter((item) => byKey.has(item.key)),
    ...chatItems.filter((item) => !isPinned(item) && inPinned(item)),
  ]
  const result = sections.flatMap((section) => {
    if (section.title !== 'Agents') return [section]
    const items = chatItems.filter((item) => !inPinned(item))

    return items.length > 0 ? [{ ...section, items }] : []
  })
  const chatsIndex = result.findIndex((section) => section.title === 'Agents')

  if (pinned.length > 0) {
    result.splice(chatsIndex === -1 ? 1 : chatsIndex, 0, { title: 'Pinned', items: pinned })
  }

  return result
}

const CHAT_SECTIONS = new Set<string | undefined>(['Pinned', 'Channels', 'Agents'])

/** The sections that hold chats, the only ones a split sidebar keeps. */
export function isChatSection(section: Section): boolean {
  return CHAT_SECTIONS.has(section.title)
}

/** Channels carries its "+" beside the title. */
export function withChannelAction(sections: Section[], action: ReactNode): Section[] {
  return sections.map((section) =>
    section.title === 'Channels' ? { ...section, action } : section,
  )
}
