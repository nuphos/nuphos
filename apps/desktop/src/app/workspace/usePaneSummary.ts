import {
  toggleChatSummary,
  useChatSummaryOpen,
  useRegisterPaneSession,
} from '../../lib/chatSummaryPanel'

import { usePaneId, useWorkspacePane } from './WorkspacePaneContext'

/** This pane's summary panel: whether it is open, and a toggle that leaves other panes alone. */
export function usePaneSummary() {
  const paneId = usePaneId()
  const open = useChatSummaryOpen(paneId)

  return { open, toggle: () => toggleChatSummary(paneId) }
}

/** As usePaneSummary, and tells the store which chat the pane shows. Call it once per pane. */
export function useOwnPaneSummary(sessionId: string | null | undefined) {
  const pane = useWorkspacePane()
  const paneId = usePaneId()

  useRegisterPaneSession(paneId, sessionId ?? null, pane?.primary ?? true)

  return usePaneSummary()
}
