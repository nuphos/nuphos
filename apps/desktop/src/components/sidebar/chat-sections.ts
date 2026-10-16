import type { Item, Section } from './types'
import type { SidebarProject } from '../../lib/sidebar-projects/model.ts'

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
 * The chat groups in team view: what the viewer pinned, their projects, then
 * the sessions they joined, all above their own Chats. A thread goes wherever
 * the row it nests under goes, so a pinned, filed or shared conversation keeps
 * its threads exactly as Chats would show them; a pinned thread takes its own
 * threads to Pinned. No chat is listed twice. An empty group contributes no
 * section, except Projects, which always offers a place to start one.
 */
export function withChatSections(
  sections: Section[],
  pinnedChatItems: Item[],
  sharedChatItems: Item[],
  isPinned: (item: Item) => unknown,
  projects?: readonly SidebarProject[],
): Section[] {
  const projectOf = new Map<string, string>(
    (projects ?? []).flatMap((project) =>
      project.sessionIds.map((id) => [`agent-session:${id}`, project.id] as const),
    ),
  )
  const chatItems = sections.find((section) => section.title === 'Chats')?.items ?? []
  const shared = new Set(sharedChatItems.map((item) => item.key))
  const byKey = new Map([...sharedChatItems, ...chatItems].map((item) => [item.key, item]))
  const live = [...byKey.values()]
  const groupOf = (item: Item, seen = new Set<string>()): string => {
    if (isPinned(item)) return 'Pinned'
    const projectId = projectOf.get(item.key)

    if (projectId) return `project:${projectId}`
    const parent = item.parentKey ? byKey.get(item.parentKey) : undefined

    if (parent && !seen.has(item.key)) return groupOf(parent, seen.add(item.key))

    return shared.has(item.key) ? 'Shared' : 'Chats'
  }
  const group = (title: string) => live.filter((item) => !isPinned(item) && groupOf(item) === title)
  const projectGroups = (projects ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    // Owned and shared chats come from separate lists; a project shows them by activity.
    items: group(`project:${project.id}`).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0)),
  }))
  const groups: Section[] = [
    { title: 'Pinned', items: [...pinnedChatItems, ...group('Pinned')] },
    ...(projects ? [{ title: 'Projects', items: [], projects: projectGroups }] : []),
    { title: 'Shared', items: group('Shared') },
  ].filter(({ items, projects: list }) => items.length > 0 || list)
  // Chats stays while chats are filed away, so one can be dragged back to it.
  const anyFiled = projectGroups.some(({ items }) => items.length > 0)
  const result = sections.flatMap((section) => {
    if (section.title !== 'Chats') return [section]
    const items = group('Chats')

    return items.length > 0 || anyFiled ? [{ ...section, items }] : []
  })
  const chatsIndex = result.findIndex((section) => section.title === 'Chats')

  result.splice(chatsIndex === -1 ? 1 : chatsIndex, 0, ...groups)

  return result
}
