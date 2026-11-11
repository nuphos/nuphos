import { useCallback, useState } from 'react'

import { SessionSearchDialog } from '../../components/session-search/SessionSearchDialog'
import { t } from '../../i18n'

import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'

/**
 * ⌘K for this pane. It stays mounted while it closes, so choosing a result or
 * pressing ⌘K again plays the same transition as opening it.
 */
export function WorkspaceSearch({
  ws,
  userId,
  shown,
  onCommand,
}: {
  ws: WorkspaceController
  userId: string
  shown: boolean
  onCommand: (id: string) => void
}) {
  const pane = useWorkspacePane()
  const [mounted, setMounted] = useState(shown)
  const onExited = useCallback(() => setMounted(false), [])

  // Mount as soon as it should show; unmount only once it has closed.
  if (shown && !mounted) setMounted(true)
  const scope = ws.scope

  if (!mounted || !scope) return null

  return (
    <SessionSearchDialog
      key={scope.teamId}
      open={shown}
      onExited={onExited}
      teamId={scope.teamId}
      teamName={ws.currentTeam?.name ?? t('Workspace')}
      otherTeams={ws.teams.filter((team) => team.id !== scope.teamId)}
      userId={userId}
      onClose={() => ws.setSessionSearchOpen(false)}
      onCommand={onCommand}
      onOpen={(sessionId, beside) => {
        ws.setSessionSearchOpen(false)
        if (beside && pane?.openSessionBeside(sessionId, scope.teamId)) return
        ws.workspaceActions.selectSession(sessionId, { teamId: scope.teamId })
      }}
    />
  )
}
