import { useEffect } from 'react'

import { focusSessionDesktop, publishSessionDesktops } from '../../../lib/sessionDesktops.ts'

import { desktopsFromRuntimeState, sessionDesktopsOf } from './shells.ts'

import type { Tab } from './model'

type TurnView = Pick<Tab, 'sessionId' | 'messages' | 'streaming' | 'runtimeState' | 'foreign'>

/** Providers may prefix MCP tools, as in `mcp__nuphos-desktop__click`. */
const DESKTOP_TOOL = /(^|__|\.|\/)nuphos-desktop(__|\.|\/)/u

/** Turns whose desktop was already brought forward, so a tab the user closes stays closed. */
const surfaced = new Set<string>()

/**
 * Opens and focuses the session's desktop tab the first time a running turn
 * drives that desktop, as local_browser does for its tab. Keyed by the turn,
 * not by the snapshot, so a chat reopened or reloaded after the turn ended
 * opens nothing (#581). A conversation someone else owns is never surfaced.
 */
export function surfaceAgentDesktop(tab: TurnView): void {
  const display = desktopsFromRuntimeState(tab.runtimeState).at(0)?.display

  if (!tab.streaming || tab.foreign || display === undefined) return
  const start = tab.messages.findLastIndex((message) => message.role === 'user')
  const drives = tab.messages
    .slice(start + 1)
    .some((message) =>
      message.parts.some((part) => part.type === 'tool' && DESKTOP_TOOL.test(part.toolName)),
    )
  const turn = `${tab.sessionId}:${tab.messages[start]?.id ?? ''}`

  if (!drives || surfaced.has(turn)) return
  surfaced.add(turn)
  focusSessionDesktop(tab.sessionId, display)
}

/** The chat's desktops for the dock, and the one its agent starts using brought forward. */
export function useSessionDesktops(tab: Tab, teamId: string | undefined): void {
  const { sessionId, messages, streaming, runtimeState, foreign } = tab

  // The workspace turns these into dock tabs; a chat that leaves the screen is forgotten, not closed.
  useEffect(() => {
    if (teamId)
      publishSessionDesktops(sessionId, sessionDesktopsOf(teamId, { runtimeState, foreign }))
  }, [sessionId, teamId, runtimeState, foreign])
  useEffect(() => () => publishSessionDesktops(sessionId, null), [sessionId])
  useEffect(() => {
    surfaceAgentDesktop({ sessionId, messages, streaming, runtimeState, foreign })
  }, [sessionId, messages, streaming, runtimeState, foreign])
}
