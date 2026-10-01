// The decision behind terminal teardown, separated from the effect that
// performs it. `useWorkspaceTabSync` observes the tab list and, for every tab
// that stopped being a terminal tab, ends its PTY. Everything about *which*
// tabs those are — and which of their sessions are genuinely orphaned — lives
// here so it can be exercised without rendering the workspace.
//
// A terminal outlives the mounted view on purpose: switching chat session swaps
// the whole dock, so the view is unmounted and remounted routinely. Only a tab
// that is gone (or navigated elsewhere) means the shell is gone.

/** The `active` page key of the local-terminal page. */
const LOCAL_TERMINAL_PAGE = 'team.terminal'

/**
 * Tab ids that own a local terminal. The PTY is keyed by tab id in the main
 * process, so unlike SSH there is no separate session id to track — the set of
 * terminal tabs *is* the set of live sessions.
 */
export function collectLocalTerminalTabIds(
  tabs: readonly { id: string; active: string }[],
): Set<string> {
  return new Set(tabs.filter((tab) => tab.active === LOCAL_TERMINAL_PAGE).map((tab) => tab.id))
}

/** The fields of a workspace tab an exec session's scope is read from. */
export type ExecTabSnapshot = {
  id: string
  kubeconfigContext: string | null
  target: { kind: string; namespace: string | null; name: string } | null
}

/**
 * The pod or node an exec session belongs to. Both the terminal (which knows it
 * from its own props) and the teardown observer (which reads it off the tab)
 * build the string here, so the two can never disagree about what is orphaned.
 */
export function execScope(
  context: string,
  kind: 'Pod' | 'Node',
  namespace: string | null,
  name: string,
): string {
  // `\u0001` rather than `\0`: the session key splits on `\0`, so the scope must
  // not contain one. A kubeconfig context name can contain anything else.
  return [context, kind, namespace ?? '', name].join('\u0001')
}

/** A tab's current exec scope, or `null` when it has no pod/node open. */
export function execScopeForTab(tab: ExecTabSnapshot): string | null {
  const { target } = tab

  if (!tab.kubeconfigContext || !target) return null
  if (target.kind !== 'Pod' && target.kind !== 'Node') return null

  return execScope(tab.kubeconfigContext, target.kind, target.namespace, target.name)
}

/**
 * The main process keys exec sessions by this. `\0` separates the tab and scope
 * halves so teardown can split them back out; the container disambiguates the
 * several shells one pod can offer (empty for a node shell, which has one).
 */
export function execSessionKey(tabId: string, scope: string, container: string): string {
  return [tabId, scope, container].join('\0')
}

/**
 * Tabs whose exec scope changed — including tabs that disappeared, which report
 * `null`. Each entry is a teardown instruction: end everything this tab owns
 * outside this scope.
 */
export function planExecTeardown(
  prev: ReadonlyMap<string, string | null>,
  next: ReadonlyMap<string, string | null>,
): { tabId: string; scope: string | null }[] {
  const plan: { tabId: string; scope: string | null }[] = []

  for (const tabId of prev.keys()) {
    if (!next.has(tabId)) plan.push({ tabId, scope: null })
  }
  for (const [tabId, scope] of next) {
    if (prev.has(tabId) && prev.get(tabId) === scope) continue
    plan.push({ tabId, scope })
  }

  return plan
}

/** Every resident tab's exec scope, in tab order. */
export function collectExecScopes(tabs: readonly ExecTabSnapshot[]): Map<string, string | null> {
  return new Map(tabs.map((tab) => [tab.id, execScopeForTab(tab)]))
}

/** The only two fields of a workspace tab this decision reads. */
export type SshTabSnapshot = {
  id: string
  sshTerminal: { sessionId: string | null } | null
}

/**
 * Tab id → the session that tab holds. `null` means the tab is an SSH tab whose
 * PTY has not come back yet (`atlasStart*Ssh` still in flight), which is a live
 * SSH tab with nothing to close.
 */
export type LiveSshTabs = ReadonlyMap<string, string | null>

export type SshTeardownPlan = {
  /**
   * Tabs that stopped being SSH tabs, in the order they were first seen. Marked
   * in the closed set so a late-resolving start promise knows to throw its
   * session away instead of adopting it.
   */
  closedTabIds: string[]
  /**
   * Sessions to end. A departing tab's session is only listed when no surviving
   * SSH tab still holds it.
   */
  sessionIdsToClose: string[]
}

const NO_LIVE_SSH_TABS: LiveSshTabs = new Map()

/** Reduce a tab list to the SSH tabs it currently contains, in tab order. */
export function collectLiveSshTabs(tabs: readonly SshTabSnapshot[]): Map<string, string | null> {
  const live = new Map<string, string | null>()

  for (const tab of tabs) {
    if (tab.sshTerminal) live.set(tab.id, tab.sshTerminal.sessionId)
  }

  return live
}

/**
 * Diff two snapshots of the live SSH tabs and report what teardown the change
 * implies. A tab counts as gone when its id is absent from `next` — whether the
 * tab itself was removed (closed, team switch, logout) or merely lost its
 * `sshTerminal` (a deep-link retarget navigating the same tab elsewhere).
 */
export function planSshTeardown(prev: LiveSshTabs, next: LiveSshTabs): SshTeardownPlan {
  const closedTabIds: string[] = []
  const sessionIdsToClose: string[] = []
  const heldSessionIds = new Set(
    [...next.values()].filter((sessionId): sessionId is string => sessionId !== null),
  )

  for (const [tabId, sessionId] of prev) {
    if (next.has(tabId)) continue
    closedTabIds.push(tabId)
    // A session another tab now holds is not orphaned: the render-time
    // duplicate-id repair re-keys a tab without ending its terminal.
    if (sessionId !== null && !heldSessionIds.has(sessionId)) {
      sessionIdsToClose.push(sessionId)
    }
  }

  return { closedTabIds, sessionIdsToClose }
}

/**
 * Logout unmounts the workspace instead of emptying the tab strip, so the
 * observer never sees these tabs go and has to be told explicitly. Every SSH tab
 * is leaving at once, so nothing can still be holding a session.
 */
export function planSshTeardownForLogout(tabs: readonly SshTabSnapshot[]): SshTeardownPlan {
  return planSshTeardown(collectLiveSshTabs(tabs), NO_LIVE_SSH_TABS)
}
