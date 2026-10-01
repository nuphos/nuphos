// Where to send the user when they click the "agent finished" native
// notification. The main process only raises the window; the conversation that
// fired the notification may be sitting in a background tab, in the docked
// sidebar, or nowhere at all — a stream outlives the surface that started it
// when its tab is closed or navigated away mid-turn.

// The workspace page key the full-page AgentPanel renders on.
const AGENT_PAGE = 'team.agent'

export type FocusableTab = {
  id: string
  active: string
  agentSessionId: string | null
  scope: { kind: string; teamId: string }
}

export type AgentSessionFocus =
  // A tab is showing the conversation full-page — just activate it.
  | { kind: 'activate-tab'; tabId: string }
  // The docked sidebar holds it. One sidebar serves the whole window, keyed by
  // the active tab's team, so it is already on screen for any tab in that team;
  // tabId is set only when the active tab belongs to another team.
  | { kind: 'open-sidebar'; tabId: string | null }
  // Not mounted anywhere — reopen the conversation as its own tab.
  | { kind: 'reopen'; sessionId: string; teamId?: string }

/**
 * The tab showing `sessionId` full-page, preferring the active tab when it is
 * one of them. A tab keeps its agentSessionId when it navigates to a non-agent
 * page, so holding the id is not the same as showing the conversation.
 */
export function findTabShowingSession<T extends FocusableTab>(
  tabs: readonly T[],
  sessionId: string,
  activeTabId: string | null,
): T | undefined {
  if (!sessionId) return undefined
  const showsSession = (tab: T) =>
    tab.agentSessionId === sessionId && tab.scope.kind === 'team' && tab.active === AGENT_PAGE
  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  return activeTab && showsSession(activeTab) ? activeTab : tabs.find(showsSession)
}

export function resolveAgentSessionFocus(args: {
  sessionId: string
  teamId?: string
  tabs: readonly FocusableTab[]
  activeTabId: string | null
  sidebarSessionId: string | null
}): AgentSessionFocus | null {
  const { sessionId, teamId, tabs, activeTabId, sidebarSessionId } = args

  if (!sessionId) return null

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const owningTab = findTabShowingSession(tabs, sessionId, activeTabId)

  if (owningTab) return { kind: 'activate-tab', tabId: owningTab.id }

  if (sidebarSessionId === sessionId) {
    // The payload named no team, or the tab in front already belongs to the
    // session's team: the sidebar is the surface, so leave the tab alone.
    if (!teamId || activeTab?.scope.teamId === teamId) {
      return { kind: 'open-sidebar', tabId: null }
    }
    const teamTab = tabs.find((tab) => tab.scope.teamId === teamId)

    // No tab left in the session's team (the user switched teams, which drops
    // every other tab but leaves the sidebar's session id behind): opening the
    // sidebar would render the conversation under the wrong scope.
    if (!teamTab) return { kind: 'reopen', sessionId, teamId }

    return { kind: 'open-sidebar', tabId: teamTab.id }
  }

  return { kind: 'reopen', sessionId, teamId }
}
