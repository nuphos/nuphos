import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/**
 * The agent groups in team view: Bots, then Tasks. A Bot is a conversation
 * with an avatar; everything else is a Task. A thread goes wherever the row it
 * nests under goes, so a Bot keeps the Tasks it started, and a Bot started as a
 * thread takes its own threads to Bots. Bots are ordered by name, a stable
 * list that needs no stored order; Tasks keep the list's newest-first order.
 * An empty group contributes no section at all.
 */
const byBotName = (a: Item, b: Item) => (a.bot && b.bot ? a.label.localeCompare(b.label) : 0)

export function withChatSections(sections: Section[]): Section[] {
  const chatItems = sections.find((section) => section.title === 'Agents')?.items ?? []
  const byKey = new Map(chatItems.map((item) => [item.key, item]))
  const inBots = (item: Item, seen = new Set<string>()): boolean => {
    if (item.bot) return true
    const parent = item.parentKey ? byKey.get(item.parentKey) : undefined

    return Boolean(parent && !seen.has(item.key) && inBots(parent, seen.add(item.key)))
  }
  // A Bot is who it is: its name and face. Its work stays in its Tasks.
  const bots = chatItems
    .filter((item) => inBots(item))
    .map((item) => (item.bot ? { ...item, description: undefined } : item))
    // Bots by name; their Tasks keep their order and nest back under them.
    .sort((a, b) => Number(Boolean(b.bot)) - Number(Boolean(a.bot)) || byBotName(a, b))
  const tasks = chatItems.filter((item) => !inBots(item))

  return sections.flatMap((section) => {
    if (section.title !== 'Agents') return [section]

    return [
      ...(bots.length > 0 ? [{ title: 'Bots', items: bots }] : []),
      ...(tasks.length > 0 ? [{ title: 'Tasks', items: tasks }] : []),
    ]
  })
}

const CHAT_SECTIONS = new Set<string | undefined>(['Channels', 'Agents', 'Bots', 'Tasks'])

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
