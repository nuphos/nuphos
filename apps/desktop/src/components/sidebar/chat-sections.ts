import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/**
 * The agent groups in team view, iMessage-style. Bots holds chats: group
 * channels and each Bot's 1:1 channel, newest message first (the list's own
 * order); a Bot without its chat yet is listed there until opened, which makes
 * it. Only its owner can bring a Bot into a chat, so a teammate's Bot without
 * one stays a Task. Tasks holds every agent session, a Bot's own included.
 */
export function withChatSections(
  sections: Section[],
  openBot?: (botId: string) => void,
  // Groups Tasks under their projects.
  projects: (tasks: Item[]) => Item[] = (tasks) => tasks,
): Section[] {
  const agents = sections.find((section) => section.title === 'Agents')

  if (!agents) return [...sections]
  const chatted = new Set(agents.items.flatMap((item) => item.botChannelOf ?? []))
  const sessionOf = (item: Item) => item.key.replace('agent-session:', '')
  const isChat = (item: Item) =>
    item.channel || (item.bot && !item.readOnlyChat && !chatted.has(sessionOf(item)))
  const chats = agents.items.filter(isChat).map((item) => ({
    ...item,
    description: undefined,
    // Bots shows faces: a Bot not yet in its chat wears its own, as its chat will.
    ...(item.bot && {
      iconNode: item.face,
      ...(openBot && { onActivate: () => openBot(sessionOf(item)) }),
    }),
  }))
  // A Task is one line: its runtime icon and title, no latest message.
  const tasks = projects(
    agents.items
      .filter((item) => !item.channel)
      .map(({ preview: _preview, time: _time, ...item }) => ({ ...item, task: true })),
  )

  return sections.flatMap((section) =>
    section === agents
      ? [
          { title: 'Channels', items: chats },
          ...(tasks.length > 0 ? [{ title: 'Tasks', items: tasks }] : []),
        ]
      : [section],
  )
}

const CHAT_SECTIONS = new Set<string | undefined>(['Channels', 'Agents', 'Tasks'])

/** The sections that hold chats, the only ones a split sidebar keeps. */
export function isChatSection(section: Section): boolean {
  return CHAT_SECTIONS.has(section.title)
}

/** Chats carries its "+" beside the title. */
export function withSectionActions(
  sections: Section[],
  actions: Partial<Record<string, ReactNode>>,
): Section[] {
  return sections.map((section) => {
    const action = section.title ? actions[section.title] : undefined

    return action ? { ...section, action } : section
  })
}
