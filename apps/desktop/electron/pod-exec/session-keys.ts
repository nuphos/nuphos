// A terminal session's identity, and which identities a tab may still open.
//
// The renderer names its own sessions: `<tabId>\0<scope>\0<container>`, where
// scope is the pod or node the owning dock tab has open (see
// `src/lib/terminalTabTeardown.ts`, which builds the same string). The key is
// stable across the view's unmount — switching chat session swaps the whole
// dock — which is what lets a remounted terminal find its session again instead
// of opening a second exec into the same container.

/** The tab and scope halves of a session key. */
export function keyParts(id: string): { tabId: string; scope: string } {
  const [tabId = '', scope = ''] = id.split('\0')

  return { tabId, scope }
}

/**
 * The last teardown instruction per tab: the only scope that tab may still open
 * sessions in (`null` = none, the tab is gone).
 *
 * A node shell takes seconds to come up — consent, then waiting for the
 * privileged pod to run — and the tab can close in that window. Without this, a
 * start that resolved late would leave a root shell running on the node with no
 * UI attached to it.
 */
const tabScopes = new Map<string, string | null>()
// Bounded: a desktop session opens a lot of tabs over its life, and only the
// most recent ones can still have a start in flight to race.
const MAX_REMEMBERED_TABS = 200

export function rememberTabScope(tabId: string, scope: string | null): void {
  // Re-insert so the map stays in least-recently-decided order.
  tabScopes.delete(tabId)
  tabScopes.set(tabId, scope)
  while (tabScopes.size > MAX_REMEMBERED_TABS) {
    const oldest = tabScopes.keys().next().value

    if (oldest === undefined) break
    tabScopes.delete(oldest)
  }
}

/** Whether `id` is still something its tab is allowed to open. */
export function tabScopeAllows(id: string): boolean {
  const { tabId, scope } = keyParts(id)

  return !tabScopes.has(tabId) || tabScopes.get(tabId) === scope
}
