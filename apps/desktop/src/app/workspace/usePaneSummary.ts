import {
  toggleChatSummary,
  useChatSummaryOpen,
  useRegisterPaneSession,
} from '../../lib/chatSummaryPanel'

import { usePaneId } from './WorkspacePaneContext'

/** The summary panel for the chat this pane shows: whether it is open, and a toggle for that chat alone. */
export function usePaneSummary() {
  const paneId = usePaneId()
  const open = useChatSummaryOpen(paneId)

  return { open, toggle: () => toggleChatSummary(paneId) }
}

/** As usePaneSummary, and tells the store which chat the pane shows. Call it once per pane. */
export function useOwnPaneSummary(sessionId: string | null | undefined) {
  const paneId = usePaneId()

  useRegisterPaneSession(paneId, sessionId ?? null)

  return usePaneSummary()
}
