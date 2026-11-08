import { Plus, X } from 'lucide-react'
import { useCallback } from 'react'

import { t } from '../../i18n'
import {
  projectName,
  removeProject,
  startNextTaskIn,
  useAddedProjects,
} from '../../lib/taskProjects'

import { NewChatButton } from './NewChatButton'
import { AddProjectButton, RowButton } from './project-actions'
import { withProjects } from './task-projects'

import type { Item, Section } from './types'
import type { ReactNode } from 'react'

/** The "+" beside Chats, which opens what it created, and Add project beside Tasks. */
export function chatSectionActions(
  teamId: string,
  onSelect: (key: string) => void,
): Record<string, ReactNode> {
  return {
    Channels: (
      <NewChatButton
        teamId={teamId}
        onCreated={(sessionId) => onSelect(`agent-session:${sessionId}`)}
      />
    ),
    Tasks: <AddProjectButton teamId={teamId} />,
  }
}

/**
 * Groups Tasks under their projects; a project's "+" starts a new task in it,
 * and a plain New task starts in none.
 */
export function useProjectRows(
  teamId: string,
  onSelect: (key: string) => void,
  toggleGroup: (section: Pick<Section, 'title'>) => void,
) {
  const added = useAddedProjects(teamId)

  const rows = useCallback(
    (tasks: Item[]) =>
      withProjects(tasks, added, (key, path, empty) => ({
        onActivate: () => toggleGroup({ title: key }),
        // Only a folder added on this computer can start a task here.
        ...(path &&
          added.includes(path) && {
            actions: (
              <>
                <RowButton
                  label={t('New task in {name}', { name: projectName(path) })}
                  onPress={() => {
                    startNextTaskIn(teamId, path)
                    onSelect('team.agent')
                  }}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                </RowButton>
                {empty && (
                  <RowButton
                    label={t('Remove project')}
                    onPress={() => removeProject(teamId, path)}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </RowButton>
                )}
              </>
            ),
          }),
      })),
    [added, teamId, onSelect, toggleGroup],
  )
  const select = useCallback(
    (key: string) => {
      if (key === 'team.agent') startNextTaskIn(teamId, null)
      onSelect(key)
    },
    [teamId, onSelect],
  )

  return { rows, select }
}
