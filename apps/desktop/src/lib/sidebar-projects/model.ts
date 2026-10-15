export type SidebarProject = { id: string; name: string; sessionIds: string[] }

export type SidebarProjectChange =
  | { kind: 'create'; id: string; name: string; sessionId?: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete'; id: string }
  /** `projectId: null` takes the chat back to Chats. */
  | { kind: 'move'; sessionId: string; projectId: string | null }

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

/**
 * Applies one change. Changes are replayed on top of whatever the server holds
 * after a conflict, so each must still make sense there: a rename or move into
 * a project someone else deleted is a no-op, and a chat is never filed twice.
 */
export function applyProjectChange(
  projects: SidebarProject[],
  change: SidebarProjectChange,
): SidebarProject[] {
  switch (change.kind) {
    case 'create': {
      if (projects.some((project) => project.id === change.id)) return projects
      const base = change.sessionId ? withoutSession(projects, change.sessionId) : projects

      return [
        ...base,
        {
          id: change.id,
          name: cleanProjectName(change.name) || 'New project',
          sessionIds: change.sessionId ? [change.sessionId] : [],
        },
      ]
    }
    case 'rename': {
      const name = cleanProjectName(change.name)

      if (!name) return projects

      return projects.map((project) => (project.id === change.id ? { ...project, name } : project))
    }
    case 'delete':
      return projects.filter((project) => project.id !== change.id)
    case 'move': {
      if (change.projectId && !projects.some((project) => project.id === change.projectId))
        return projects
      const base = withoutSession(projects, change.sessionId)

      return change.projectId
        ? base.map((project) =>
            project.id === change.projectId
              ? { ...project, sessionIds: [...project.sessionIds, change.sessionId] }
              : project,
          )
        : base
    }
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
