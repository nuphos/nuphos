import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/** The internal title of the Bots group (chats); the sidebar labels it Bots. */
export const BOTS_SECTION = 'Channels'

/** Bots holds chats and fallback Bot entries; Tasks holds ordinary sessions only. */
export function withChatSections(
  sections: Section[],
  openBot?: (botId: string) => void,
  // Groups Tasks under their projects.
  projects: (tasks: Item[]) => Item[] = (tasks) => tasks,
): Section[] {
  const agents = sections.find((section) => section.title === 'Agents')

  if (!agents) return [...sections]
  const chatted = new Set(
    agents.items.flatMap((item) => item.channelAgentIds ?? item.botChannelOf ?? []),
  )
  const sessionOf = (item: Item) => item.key.replace('agent-session:', '')
  const isChat = (item: Item) => item.channel || (item.bot && !chatted.has(sessionOf(item)))
  const chats = agents.items.filter(isChat).map((item) => ({
    ...item,
    description: undefined,
    // Bots shows faces: a Bot not yet in its chat wears its own, as its chat will.
    ...(item.bot && {
      iconNode: item.face,
      ...(openBot && !item.readOnlyChat && { onActivate: () => openBot(sessionOf(item)) }),
    }),
  }))
  // A Task is one line: its runtime icon and title, no latest message.
  const tasks = projects(
    agents.items
      .filter((item) => !item.channel && !item.bot)
      .map(({ preview: _preview, time: _time, ...item }) => ({ ...item, task: true })),
  )

  return sections.flatMap((section) =>
    section === agents
      ? [
          { title: BOTS_SECTION, items: chats },
          ...(tasks.length > 0 ? [{ title: 'Tasks', items: tasks }] : []),
        ]
      : [section],
  )
}

const CHAT_SECTIONS = new Set<string | undefined>([BOTS_SECTION, 'Agents', 'Tasks'])

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
