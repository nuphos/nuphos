import { useContext, useEffect } from 'react'

import { WorkspaceTabContext } from '../../../hooks/useWorkspaceTab.ts'
import { refreshSessionReader, registerSessionReader } from '../../../lib/agentUnreadSessions.ts'

/** Mounted main-pane conversations are visible without a workspace tab provider.
 * Keep-alive workspace tabs still require their explicit active flag. */
export function useConversationRead(sessionId: string, visible: boolean) {
  const workspaceTab = useContext(WorkspaceTabContext)
  const onScreen = visible && (workspaceTab?.isActive ?? true)

  useEffect(() => {
    if (!onScreen || !sessionId) return
    const isReading = () => document.visibilityState !== 'hidden' && document.hasFocus()
    const unregister = registerSessionReader(sessionId, isReading)
    const markIfFocused = () => refreshSessionReader(sessionId)

    window.addEventListener('focus', markIfFocused)
    document.addEventListener('visibilitychange', markIfFocused)

    return () => {
      unregister()
      window.removeEventListener('focus', markIfFocused)
      document.removeEventListener('visibilitychange', markIfFocused)
    }
  }, [onScreen, sessionId])
}
