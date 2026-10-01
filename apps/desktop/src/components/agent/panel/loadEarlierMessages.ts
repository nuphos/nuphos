import { api } from '../../../api'

import { finalizeIncompleteTools } from './clientTools'
import { EARLIER_MESSAGES_PAGE_SIZE } from './model'
import { fromPersistedMessages } from './persistence'
import { INTERRUPTED_TOOL_MESSAGE } from './stall'

import type { PanelCtx } from './ctx'

type LoadEarlierCtx = Pick<PanelCtx, 'setTabs' | 'tabsRef' | 'teamId'>

// Prepend the previous page of a tail-loaded conversation (scroll-up paging).
// historyBaseIndex walks down toward 0 as pages arrive; the double-check
// against `before` drops a stale response if two triggers raced.
export async function runLoadEarlierMessages(ctx: LoadEarlierCtx, tabId: string) {
  const { setTabs, tabsRef, teamId } = ctx
  const tab = tabsRef.current.find((t) => t.id === tabId)

  if (!tab?.sessionId) return
  const before = tab.historyBaseIndex ?? 0

  if (before <= 0 || tab.loadingEarlier) return
  setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, loadingEarlier: true } : t)))
  try {
    const page = await api.agentGetConversationMessages(
      tab.sessionId,
      { before, limit: EARLIER_MESSAGES_PAGE_SIZE },
      teamId,
    )
    const earlier = finalizeIncompleteTools(
      fromPersistedMessages(page.messages),
      INTERRUPTED_TOOL_MESSAGE,
    )

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t
        if ((t.historyBaseIndex ?? 0) !== before || earlier.length === 0) {
          return { ...t, loadingEarlier: false }
        }

        return {
          ...t,
          messages: [...earlier, ...t.messages],
          historyBaseIndex: page.firstIndex,
          loadingEarlier: false,
        }
      }),
    )
  } catch (err) {
    console.warn('[agent] failed to load earlier messages', err)
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, loadingEarlier: false } : t)))
  }
}
