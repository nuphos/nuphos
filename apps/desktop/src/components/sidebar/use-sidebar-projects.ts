import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createSidebarProject,
  onSidebarProjectCreated,
  readSidebarProjects,
  subscribeSidebarProjects,
  syncSidebarProjects,
  updateSidebarProjects,
} from '../../lib/sidebarProjects'
import { toast } from '../ui/toast'

import type { SidebarProject, SidebarProjectChange } from '../../lib/sidebarProjects'

export type SidebarProjectsController = {
  list: SidebarProject[]
  projectOf: (sessionId: string) => SidebarProject | undefined
  /** Creates "New project" (optionally holding a chat) and starts renaming it. */
  create: (sessionId?: string) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  move: (sessionId: string, projectId: string | null) => void
  /** The project whose name is being edited in place. */
  renamingId: string | null
  setRenamingId: (id: string | null) => void
}

/** This person's projects in this team, kept in sync with the server copy. */
export function useSidebarProjects({
  userId,
  teamId,
}: {
  userId: string
  teamId: string
}): SidebarProjectsController {
  const [list, setList] = useState(() => readSidebarProjects(userId, teamId))
  const [scope, setScope] = useState(`${userId}|${teamId}`)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  if (scope !== `${userId}|${teamId}`) {
    setScope(`${userId}|${teamId}`)
    setList(readSidebarProjects(userId, teamId))
    setRenamingId(null)
  }
  useEffect(() => {
    if (!userId || !teamId) return
    void syncSidebarProjects(userId, teamId).catch(() => {
      // Keep the cached list; the next change retries against the server.
    })
    const unsubscribe = subscribeSidebarProjects(userId, teamId, () =>
      setList(readSidebarProjects(userId, teamId)),
    )
    const unwatch = onSidebarProjectCreated(userId, teamId, setRenamingId)

    return () => {
      unsubscribe()
      unwatch()
    }
  }, [teamId, userId])

  const change = useCallback(
    (next: SidebarProjectChange) => {
      updateSidebarProjects(userId, teamId, next).catch((error: unknown) =>
        toast.apiError('Could not save projects', error),
      )
    },
    [teamId, userId],
  )

  return useMemo(
    () => ({
      list,
      projectOf: (sessionId) => list.find((project) => project.sessionIds.includes(sessionId)),
      create: (sessionId) => {
        createSidebarProject(userId, teamId, sessionId).saved.catch((error: unknown) =>
          toast.apiError('Could not create project', error),
        )
      },
      rename: (id, name) => change({ kind: 'rename', id, name }),
      remove: (id) => change({ kind: 'delete', id }),
      move: (sessionId, projectId) => change({ kind: 'move', sessionId, projectId }),
      renamingId,
      setRenamingId,
    }),
    [change, list, renamingId, teamId, userId],
  )
}
