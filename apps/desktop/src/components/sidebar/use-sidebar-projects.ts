import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  filedChatCount,
  MAX_FILED_CHATS,
  projectChangeRefusal,
} from '../../lib/sidebar-projects/model'
import { reachableSessionIds } from '../../lib/sidebar-projects/prune'

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
    void syncSidebarProjects(userId, teamId)
    const unsubscribe = subscribeSidebarProjects(userId, teamId, () =>
      setList(readSidebarProjects(userId, teamId)),
    )
    const unwatch = onSidebarProjectCreated(userId, teamId, setRenamingId)

    return () => {
      unsubscribe()
      unwatch()
    }
  }, [teamId, userId])

  // Deleted chats stay filed until something removes them; once projects hold
  // three quarters of the cap, drop the ones no longer reachable (at most once a session).
  const pruned = useRef(new Set<string>())

  useEffect(() => {
    const key = `${userId}|${teamId}`

    if (!userId || !teamId || pruned.current.has(key)) return
    if (filedChatCount(list) < MAX_FILED_CHATS * 0.75) return
    pruned.current.add(key)
    void reachableSessionIds(teamId)
      .then((reachable) => {
        if (!reachable) return
        const gone = list
          .flatMap((project) => project.sessionIds)
          .filter((id) => !reachable.has(id))

        if (gone.length > 0)
          updateSidebarProjects(userId, teamId, { kind: 'forget', sessionIds: gone })
      })
      .catch(() => {
        // Try again next session.
      })
  }, [list, teamId, userId])

  const change = useCallback(
    (next: SidebarProjectChange) => {
      const refusal = projectChangeRefusal(readSidebarProjects(userId, teamId), next)

      if (refusal) toast.error('Could not change projects', refusal)
      else updateSidebarProjects(userId, teamId, next)
    },
    [teamId, userId],
  )

  return useMemo(
    () => ({
      list,
      projectOf: (sessionId) => list.find((project) => project.sessionIds.includes(sessionId)),
      create: (sessionId) => {
        const refusal = projectChangeRefusal(list, { kind: 'create', id: '', name: '', sessionId })

        if (refusal) toast.error('Could not create project', refusal)
        else createSidebarProject(userId, teamId, sessionId)
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
