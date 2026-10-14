import { ChevronRight, Folder, FolderInput, FolderMinus, FolderPlus } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  createSidebarProject,
  readSidebarProjects,
  subscribeSidebarProjects,
  updateSidebarProjects,
} from '../../lib/sidebarProjects'
import { MenuContent, MenuItem, MenuSeparator, MenuSubmenu, MenuSubmenuTrigger } from '../ui/menu'
import { toast } from '../ui/toast'

type Props = { userId: string; teamId: string; sessionId: string }

function useProjects(userId: string, teamId: string) {
  const [projects, setProjects] = useState(() => readSidebarProjects(userId, teamId))

  useEffect(
    () =>
      subscribeSidebarProjects(userId, teamId, () =>
        setProjects(readSidebarProjects(userId, teamId)),
      ),
    [teamId, userId],
  )

  return projects
}

/** "Move to project" for the open chat: a new project, the others, or back to Chats. */
export function SessionProjectSubmenu({ userId, teamId, sessionId }: Props) {
  const projects = useProjects(userId, teamId)
  const current = projects.find((project) => project.sessionIds.includes(sessionId))
  const others = projects.filter((project) => project !== current)

  function move(projectId: string | null) {
    updateSidebarProjects(userId, teamId, { kind: 'move', sessionId, projectId }).catch(
      (error: unknown) => toast.apiError('Could not move chat', error),
    )
  }

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger
        icon={<FolderInput className="h-3.5 w-3.5" />}
        chevron={<ChevronRight className="h-3 w-3" />}
      >
        Move to project
      </MenuSubmenuTrigger>
      <MenuContent align="start" className="w-[200px]">
        <MenuItem
          icon={<FolderPlus className="h-3.5 w-3.5" />}
          onClick={() => {
            createSidebarProject(userId, teamId, sessionId).saved.catch((error: unknown) =>
              toast.apiError('Could not create project', error),
            )
          }}
        >
          New project
        </MenuItem>
        {others.length > 0 && <MenuSeparator />}
        {others.map((project) => (
          <MenuItem
            key={project.id}
            icon={<Folder className="h-3.5 w-3.5" />}
            onClick={() => move(project.id)}
          >
            <span className="block truncate">{project.name}</span>
          </MenuItem>
        ))}
        {current && (
          <>
            <MenuSeparator />
            <MenuItem icon={<FolderMinus className="h-3.5 w-3.5" />} onClick={() => move(null)}>
              <span className="block truncate">Remove from {current.name}</span>
            </MenuItem>
          </>
        )}
      </MenuContent>
    </MenuSubmenu>
  )
}
