import { useState } from 'react'

import { BotTaskMode } from './BotTaskMode'
import { WorkspaceDockPanels } from './WorkspaceDockPanels'
import { WorkspaceMainPane } from './WorkspaceMainPane'
import { WorkspaceSessionPane } from './WorkspaceSessionPane'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

/** Temporary Bot work covers the conversation without changing its dock or navigation. */
export function WorkspaceConversationSurface({
  ws,
  user,
}: {
  ws: WorkspaceController
  user: UserInfo
}) {
  const [task, setTask] = useState<{ conversationId: string | null; sessionId: string } | null>(
    null,
  )
  const [conversationId, setConversationId] = useState(ws.selectedSessionId)

  if (conversationId !== ws.selectedSessionId) {
    setConversationId(ws.selectedSessionId)
    setTask(null)
  }
  const taskOpen = Boolean(task) && !ws.mainPageOpen

  return (
    <div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
      <div className="flex flex-1 min-h-0 min-w-0" inert={taskOpen}>
        <WorkspaceSessionPane
          ws={ws}
          user={user}
          workspaceExpanded={ws.workspaceDockExpanded || ws.mainPageOpen}
          onOpenTask={(sessionId) => setTask({ conversationId: ws.selectedSessionId, sessionId })}
        />
        {ws.mainPageOpen ? (
          <WorkspaceMainPane ws={ws} user={user} />
        ) : (
          <WorkspaceDockPanels ws={ws} user={user} />
        )}
      </div>
      {taskOpen && task && ws.scope?.teamId && (
        <BotTaskMode
          ws={ws}
          user={user}
          teamId={ws.scope.teamId}
          sessionId={task.sessionId}
          onSessionChange={(sessionId) => setTask({ ...task, sessionId })}
          onBack={() => setTask(null)}
        />
      )}
    </div>
  )
}
