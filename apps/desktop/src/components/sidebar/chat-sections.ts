import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/** The internal title of the Bots group (chats); the sidebar labels it Bots. */
export const BOTS_SECTION = 'Channels'

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
  const chatted = new Set(
    agents.items.flatMap((item) => item.channelAgentIds ?? item.botChannelOf ?? []),
  )
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
  // A Bot's Task links to its chat, so the two rows read as one agent.
  const botChatOf = (item: Item): Item['botChat'] => {
    if (!item.bot) return undefined
    const botId = sessionOf(item)
    // Its own chat first; once teammates are invited that chat is a group with the Bot in it.
    const chat =
      agents.items.find((other) => other.botChannelOf === botId) ??
      agents.items.find((other) => other.channelAgentIds?.includes(botId))

    if (chat) return { botId, provider: item.provider, name: chat.label, key: chat.key }

    // Only its owner can bring a Bot into a chat, so a teammate's Bot without one has no link.
    return openBot && !item.readOnlyChat
      ? { botId, provider: item.provider, name: item.label, open: () => openBot(botId) }
      : undefined
  }
  // A Task is one line: its runtime icon and title, no latest message.
  const tasks = projects(
    agents.items
      .filter((item) => !item.channel)
      .map(({ preview: _preview, time: _time, ...item }) => {
        const botChat = botChatOf(item)

        return { ...item, task: true, ...(botChat && { botChat }) }
      }),
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
