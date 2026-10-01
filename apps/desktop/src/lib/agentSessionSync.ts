/**
 * Reconciliation between the session id the workspace owns (the URL, and so
 * the tab's history) and the one the Agent panel is actually showing.
 *
 * Both sides can move — the URL on navigation, the panel on "new chat" / open
 * recent / close — so the rule is stated once, here, as a pure decision. It
 * used to be nested `if`s inside the panel, where the case that matters most
 * was invisible: an open is *asynchronous*, so between "the URL asked for
 * conversation X" and "the panel is showing X" the panel shows nothing, and a
 * re-render in that window looked exactly like "the user closed the chat".
 * The panel then published null, which navigated the workspace tab to Agent
 * Home and pushed that into the tab's history — which is why Back from a chat
 * opened off a list returned Home instead of the list.
 */
export type SessionSyncInput = {
  /** What the workspace wants shown. `undefined` = the panel is uncontrolled. */
  prop: string | null | undefined
  /** What the panel is showing right now. */
  internal: string | null
  /** The value the last reconciliation settled on, to tell which side moved. */
  lastSynced: string | null | undefined
  /** Conversation currently being fetched, if any. */
  opening: string | null
  /** Session a snapshot import is about to install, if any. */
  pendingImport: string | null
  /** Whether the panel already holds a loaded tab for `prop`. */
  hasLoadedTabForProp: boolean
}

export type SessionSyncAction =
  /** Uncontrolled panel — the workspace has no opinion. */
  | { kind: 'ignore' }
  /** A snapshot import owns this transition; don't race it. */
  | { kind: 'defer-to-import' }
  /** Both sides already agree; just record it. */
  | { kind: 'adopt' }
  /** The open for `prop` is still in flight — not a change, just not caught up. */
  | { kind: 'awaiting-open' }
  /** The panel moved; tell the workspace so the URL follows. */
  | { kind: 'publish'; sessionId: string | null }
  /** The workspace cleared the session; go back to the panel's home. */
  | { kind: 'clear' }
  /** The workspace picked a conversation the panel already has loaded. */
  | { kind: 'activate'; sessionId: string }
  /** The workspace picked a conversation the panel must fetch. */
  | { kind: 'open'; sessionId: string }

export function resolveSessionSync(input: SessionSyncInput): SessionSyncAction {
  const { prop, internal, lastSynced, opening, pendingImport } = input

  if (prop === undefined) return { kind: 'ignore' }
  if (pendingImport !== null && pendingImport === prop) return { kind: 'defer-to-import' }
  // Settled — but only with nothing else being fetched. Dismissing a chat while
  // it loads leaves prop null and internal still null, and treating that
  // coincidence as agreement strands the fetch: when it lands the panel is
  // holding the conversation the user just dismissed, and publishes it back.
  if (internal === prop && (opening === null || opening === prop)) {
    return { kind: 'adopt' }
  }

  // The prop is unchanged since the last reconciliation, so it was the panel
  // that moved — unless we are still fetching exactly what the prop asked for.
  if (lastSynced === prop) {
    if (opening !== null && opening === prop) return { kind: 'awaiting-open' }

    return { kind: 'publish', sessionId: internal }
  }

  if (prop === null) return { kind: 'clear' }
  if (input.hasLoadedTabForProp) return { kind: 'activate', sessionId: prop }

  return { kind: 'open', sessionId: prop }
}
