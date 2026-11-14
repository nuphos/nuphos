import { doneGroup, nestItems } from './nest-items.ts'

import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/** The internal title of the Bots group (chats); the sidebar labels it Bots. */
export const BOTS_SECTION = 'Channels'

/** Bot tree fold keys stay scoped to the Bots section. */
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
  const copies = new Set(agents.items.filter((item) => item.botNested).map((item) => item.key))
  const isChat = (item: Item) =>
    item.channel || item.botNested || (item.bot && !chatted.has(sessionOf(item)))
  // Read ancestry from the original rows, before Bot-chat copies reparent them.
  const originals = new Map(
    agents.items.filter((item) => !item.botNested).map((item) => [item.key, item]),
  )
  const botOwner = (item: Item): Item | undefined => {
    const seen = new Set<string>()
    let parent = item.parentKey

    while (parent && !seen.has(parent)) {
      seen.add(parent)
      const row = originals.get(parent)

      if (!row) return undefined
      if (row.bot) return row
      parent = row.parentKey
    }

    return undefined
  }
  const owners = new Map([...originals].map(([key, item]) => [key, botOwner(item)]))
  const chatByBot = new Map<string, string>()

  for (const item of agents.items) {
    if (!item.channel) continue
    for (const botId of item.channelAgentIds ?? (item.botChannelOf ? [item.botChannelOf] : []))
      if (!chatByBot.has(botId)) chatByBot.set(botId, item.key)
  }
  const chats = agents.items
    .filter((item) => isChat(item) || (owners.get(item.key) && !copies.has(item.key)))
    .map((item) => {
      const owner = owners.get(item.key)

      return {
        ...item,
        description: undefined,
        ...(owner &&
          !item.botNested && {
            botNested: true,
            task: true,
            // The Bot's own row is replaced by its chat; descendants keep their parents.
            ...(item.parentKey === owner.key && {
              parentKey: chatByBot.get(sessionOf(owner)) ?? item.parentKey,
            }),
          }),
        // Bots shows faces: a Bot not yet in its chat wears its own, as its chat will.
        ...(item.bot && {
          iconNode: item.face,
          ...(openBot && !item.readOnlyChat && { onActivate: () => openBot(sessionOf(item)) }),
        }),
      }
    })
  // A Task is one line: its runtime icon and title, no latest message.
  const tasks = projects(
    agents.items
      .filter((item) => !item.channel && !item.bot && !item.botNested && !owners.get(item.key))
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

/** A pinned Bot owns its whole tree; no descendant becomes an orphaned list root. */
export function unpinnedChatItems(items: Item[], pinned: (item: Item) => boolean): Item[] {
  const byKey = new Map(items.map((item) => [item.key, item]))

  return items.filter((item) => {
    const seen = new Set<string>()
    let row: Item | undefined = item

    while (row && !seen.has(row.key)) {
      if (pinned(row)) return false
      seen.add(row.key)
      row = row.parentKey ? byKey.get(row.parentKey) : undefined
    }

    return true
  })
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
