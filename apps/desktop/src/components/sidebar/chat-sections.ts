import { doneGroup, nestItems } from './nest-items.ts'

import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/** The internal title of the Bots group (chats); the sidebar labels it Bots. */
export const BOTS_SECTION = 'Channels'

/** A Bot's nested task folds independently from its copy in Tasks. */
export function foldKey(section: Pick<Section, 'title'>, key: string): string {
  return section.title === BOTS_SECTION ? `bots:${key}` : key
}

type Fold = Pick<Section, 'title' | 'defaultCollapsed'>

/** A section's rows as nested, with its thread folds and done groups read and toggled by row key. */
export function sectionFolds(
  section: Pick<Section, 'title' | 'items'>,
  isCollapsed: (fold: Fold) => boolean,
  toggle?: (fold: Fold) => void,
) {
  const done = (key: string) => doneGroup(foldKey(section, key))
  const folded = (key: string) => isCollapsed({ title: foldKey(section, key) })
  const doneOpen = (key: string) => !isCollapsed(done(key))

  return {
    nest: () => nestItems(section.items, folded, doneOpen),
    folded,
    toggleFold: (key: string) => toggle?.({ title: foldKey(section, key) }),
    doneOpen,
    toggleDone: (key: string) => toggle?.(done(key)),
  }
}

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
  const isChat = (item: Item) =>
    item.channel || item.botNested || (item.bot && !chatted.has(sessionOf(item)))
  const chats = agents.items.filter(isChat).map((item) => ({
    ...item,
    description: undefined,
    // Bots shows faces: a Bot not yet in its chat wears its own, as its chat will.
    ...(item.bot && {
      iconNode: item.face,
      ...(openBot && !item.readOnlyChat && { onActivate: () => openBot(sessionOf(item)) }),
    }),
  }))
  const isTask = (item: Item) => !item.channel && !item.bot && !item.botNested
  const parents = new Set(agents.items.filter(isTask).flatMap((item) => item.parentKey ?? []))
  // A Task is one line: its runtime icon and title, no latest message. A Bot's
  // own Task is listed only to hold its sub-agents, and as a Task, not the Bot.
  const tasks = projects(
    agents.items
      .filter((item) => isTask(item) || (item.bot && parents.has(item.key)))
      .map(({ preview: _preview, time: _time, bot: _bot, face: _face, ...item }) => ({
        ...item,
        task: true,
      })),
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
