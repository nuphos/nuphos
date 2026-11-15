import { useState } from 'react'

import { BotTaskMode } from './BotTaskMode'
import { WorkspaceDockPanels } from './WorkspaceDockPanels'
import { WorkspaceSessionPane } from './WorkspaceSessionPane'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

/** Temporary Bot work covers the conversation column; the dock beside it stays usable. */
export function WorkspaceConversationSurface({
  ws,
  user,
}: {
  ws: WorkspaceController
  user: UserInfo
}) {
  const [taskSessionId, setTaskSessionId] = useState<string | null>(null)
  const surfaceKey = `${ws.scope?.teamId ?? ''}:${ws.selectedSessionId ?? ''}:${ws.mainPageOpen}`
  const [seededSurfaceKey, setSeededSurfaceKey] = useState(surfaceKey)

  if (seededSurfaceKey !== surfaceKey) {
    setSeededSurfaceKey(surfaceKey)
    setTaskSessionId(null)
  }
  const taskOpen = Boolean(taskSessionId) && !ws.mainPageOpen

  return (
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
      <div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex flex-1 min-h-0 min-w-0" inert={taskOpen}>
          <WorkspaceSessionPane
            ws={ws}
            user={user}
            workspaceExpanded={ws.workspaceDockExpanded || ws.mainPageOpen}
            onOpenTask={setTaskSessionId}
          />
        </div>
        {taskOpen && taskSessionId && ws.scope?.teamId && (
          <BotTaskMode
            ws={ws}
            user={user}
            teamId={ws.scope.teamId}
            sessionId={taskSessionId}
            onSessionChange={setTaskSessionId}
            onBack={() => setTaskSessionId(null)}
          />
        )}
      </div>
      <WorkspaceDockPanels ws={ws} user={user} />
    </div>
  )
}
