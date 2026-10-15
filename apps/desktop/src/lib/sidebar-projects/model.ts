export type SidebarProject = {
  id: string
  name: string
  sessionIds: string[]
  /** Set once the chats were dragged into an order; until then they list by recent activity. */
  manualOrder?: boolean
}

export type SidebarProjectChange =
  | { kind: 'create'; id: string; name: string; sessionId?: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete'; id: string }
  /** `projectId: null` takes the chat back to Chats. */
  | { kind: 'move'; sessionId: string; projectId: string | null }
  /** The projects in this order. */
  | { kind: 'arrange'; ids: string[] }
  /** A project's chats in this order, which also switches it to manual order. */
  | { kind: 'order'; id: string; sessionIds: string[] }
  | { kind: 'sortByRecent'; id: string }

export const PROJECT_NAME_MAX = 80

export function cleanProjectName(name: string): string {
  return name.trim().slice(0, PROJECT_NAME_MAX)
}

function withoutSession(projects: SidebarProject[], sessionId: string): SidebarProject[] {
  return projects.map((project) =>
    project.sessionIds.includes(sessionId)
      ? { ...project, sessionIds: project.sessionIds.filter((id) => id !== sessionId) }
      : project,
  )
}

/** `wanted` first, in its order, then anything in `current` it left out. */
function reorder(current: readonly string[], wanted: readonly string[]): string[] {
  const head = wanted.filter((id, index) => current.includes(id) && wanted.indexOf(id) === index)

  return [...head, ...current.filter((id) => !head.includes(id))]
}

function update(
  projects: SidebarProject[],
  id: string,
  edit: (project: SidebarProject) => SidebarProject,
): SidebarProject[] {
  return projects.map((project) => (project.id === id ? edit(project) : project))
}

function create(
  projects: SidebarProject[],
  change: Extract<SidebarProjectChange, { kind: 'create' }>,
): SidebarProject[] {
  if (projects.some((project) => project.id === change.id)) return projects
  const base = change.sessionId ? withoutSession(projects, change.sessionId) : projects
  const sessionIds = change.sessionId ? [change.sessionId] : []

  return [
    ...base,
    { id: change.id, name: cleanProjectName(change.name) || 'New project', sessionIds },
  ]
}

function move(projects: SidebarProject[], sessionId: string, projectId: string | null) {
  if (projectId && !projects.some((project) => project.id === projectId)) return projects
  const base = withoutSession(projects, sessionId)

  // A hand-ordered project takes a new chat at the top, where recent order would put it.
  return projectId
    ? update(base, projectId, (project) => ({
        ...project,
        sessionIds: [sessionId, ...project.sessionIds],
      }))
    : base
}

/**
 * Applies one change. After a conflict, changes are replayed on whatever the
 * server holds, so a change aimed at a project someone else deleted does nothing.
 */
export function applyProjectChange(
  projects: SidebarProject[],
  change: SidebarProjectChange,
): SidebarProject[] {
  switch (change.kind) {
    case 'create':
      return create(projects, change)
    case 'rename': {
      const name = cleanProjectName(change.name)

      return name ? update(projects, change.id, (project) => ({ ...project, name })) : projects
    }
    case 'delete':
      return projects.filter((project) => project.id !== change.id)
    case 'move':
      return move(projects, change.sessionId, change.projectId)
    case 'arrange': {
      const order = reorder(
        projects.map((project) => project.id),
        change.ids,
      )

      return order.flatMap((id) => projects.filter((project) => project.id === id))
    }
    case 'order':
      return update(projects, change.id, (project) => ({
        ...project,
        sessionIds: reorder(project.sessionIds, change.sessionIds),
        manualOrder: true,
      }))
    case 'sortByRecent':
      return update(projects, change.id, ({ manualOrder: _manual, ...project }) => project)
  }
}

export function projectForSession(
  projects: readonly SidebarProject[],
  sessionId: string,
): SidebarProject | undefined {
  return projects.find((project) => project.sessionIds.includes(sessionId))
}

/** "New project", then "New project 2", … so a fresh one is easy to tell apart. */
export function nextProjectName(projects: readonly SidebarProject[]): string {
  const names = new Set(projects.map((project) => project.name))

  if (!names.has('New project')) return 'New project'
  let index = 2

  while (names.has(`New project ${String(index)}`)) index += 1

  return `New project ${String(index)}`
}

/** Where a dropped chat lands among a project's listed chats. */
export function placeBeside(
  listed: readonly string[],
  dragged: string,
  target: string,
  position: 'before' | 'after',
): string[] {
  const rest = listed.filter((id) => id !== dragged)
  const at = rest.indexOf(target)

  if (at === -1) return [dragged, ...rest]
  rest.splice(position === 'before' ? at : at + 1, 0, dragged)

  return rest
}
