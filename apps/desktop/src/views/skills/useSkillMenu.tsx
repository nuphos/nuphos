import { Trash2, Users } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import type { MenuState } from './skillsShared'
import type { SkillScope, TeamSkillSummary } from '../../api'
import type { ContextMenuItem } from '../../components/ContextMenu'

type MenuArgs = {
  teamId: string
  scope: SkillScope
  menu: MenuState | null
  canDelete: boolean
  canPromote: boolean
  deleteSkill: (skill: TeamSkillSummary) => Promise<void>
  /** Called once a personal skill has moved to the team store. */
  onPromoted: (name: string) => Promise<void>
}

export function useSkillMenu(args: MenuArgs): ContextMenuItem[] {
  const { teamId, scope, menu, canDelete, canPromote, deleteSkill, onPromoted } = args
  const promoteSkill = useCallback(
    async (skill: TeamSkillSummary) => {
      try {
        await api.teamSkillsPromote(teamId, skill.name)
        toast.success('Moved to team skills', skill.name)
        await onPromoted(skill.name)
      } catch (err) {
        toast.apiError('Could not move skill', err)
      }
    },
    [onPromoted, teamId],
  )

  // Built with useMemo, not a helper called from the JSX: a function invoked
  // during render may not reach a ref, and deleteSkill transitively does.
  return useMemo<ContextMenuItem[]>(() => {
    if (!menu || !canDelete) return []
    const skill = menu.skill
    const promote: ContextMenuItem[] =
      scope === 'personal' && canPromote
        ? [
            {
              key: 'promote-skill',
              label: 'Move to team skills',
              icon: Users,
              confirm: `Move "${skill.name}" to the team's skills? Everyone in the team will see and use it.`,
              onSelect: () => void promoteSkill(skill),
            },
          ]
        : []

    return [
      ...promote,
      {
        key: 'delete-skill',
        label: 'Delete skill',
        icon: Trash2,
        destructive: true,
        confirm: `Delete skill "${skill.name}" and all ${String(skill.fileCount)} file(s)? This cannot be undone.`,
        onSelect: () => void deleteSkill(skill),
      },
    ]
  }, [menu, canDelete, canPromote, scope, deleteSkill, promoteSkill])
}
