// The desktops each conversation on screen holds, read off its runtime snapshot
// by the chat and turned into dock tabs by the workspace: a tab opens when a
// session's desktop first appears and goes when the desktop is torn down, the way
// a shell tab follows its PTY. One the user closes stays closed while that desktop
// lives; New Tab → Desktop or the switcher brings it back. Nothing is persisted;
// the snapshot is the source.

/** `title` names the machine and the display, e.g. "Box 1 · :3". */
export type SessionDesktop = { display: number; title: string }
/** `canOpen`: its Box runs a desktop pool, so the owner may open one by hand. */
export type SessionDesktops = { teamId: string; desktops: SessionDesktop[]; canOpen?: boolean }

const DESKTOP_PAGE = 'team.desktop'
const bySession = new Map<string, SessionDesktops>()
const listeners = new Set<() => void>()
let focus: { sessionId: string; display: number } | null = null
/**
 * The displays each session was last seen holding, kept while its chat is off
 * screen, so a desktop opens a tab once: when it appears, not every time the
 * chat comes back. A session leaves it when it holds no desktop.
 */
const seen = new Map<string, Set<number>>()
let appeared: { sessionId: string; display: number }[] = []

export function desktopTabId(sessionId: string, display: number): string {
  return `desktop:${sessionId}:${String(display)}`
}

/** `null` forgets a session whose chat left the screen, without closing its tabs. */
export function publishSessionDesktops(sessionId: string, desktops: SessionDesktops | null): void {
  const before = bySession.get(sessionId)
  const same = desktops
    ? before?.teamId === desktops.teamId &&
      JSON.stringify(before.desktops) === JSON.stringify(desktops.desktops) &&
      before.canOpen === desktops.canOpen
    : !before

  if (same) return
  if (desktops) {
    const shown = seen.get(sessionId)
    const displays = desktops.desktops.map((desktop) => desktop.display)

    appeared = displays
      .filter((display) => !shown?.has(display))
      .map((display) => ({ sessionId, display }))
    if (displays.length) seen.set(sessionId, new Set(displays))
    else seen.delete(sessionId)
    bySession.set(sessionId, desktops)
  } else bySession.delete(sessionId)
  for (const notify of listeners) notify()
  appeared = []
}

/** The desktops that just appeared, only while a publish notifies: the tabs to open. */
export function readAppearedDesktops(): readonly { sessionId: string; display: number }[] {
  return appeared
}

/** Brings a session's desktop tab to the front, in whichever workspace holds it. */
export function focusSessionDesktop(sessionId: string, display: number): void {
  focus = { sessionId, display }
  for (const notify of listeners) notify()
  focus = null
}

/** The tab a `focusSessionDesktop` call is bringing forward, only while it notifies. */
export function readDesktopFocus(): { sessionId: string; display: number } | null {
  return focus
}

export function canOpenSessionDesktop(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId && bySession.get(sessionId)?.canOpen)
}

export function subscribeSessionDesktops(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function readSessionDesktops(): ReadonlyMap<string, SessionDesktops> {
  return bySession
}

/** The title the session's snapshot gives a display, while it still holds it. */
export function sessionDesktopTitle(sessionId: string, display: number): string | undefined {
  return bySession.get(sessionId)?.desktops.find((desktop) => desktop.display === display)?.title
}

export type DesktopTabPlan = {
  open: { sessionId: string; teamId: string; display: number }[]
  close: string[]
}

/** Tabs for the `opening` desktops that have none, and the tabs whose desktop is gone. */
export function planDesktopTabs(
  sessions: ReadonlyMap<string, SessionDesktops>,
  tabsOf: (sessionId: string) => readonly { id: string; active: string }[],
  opening: readonly { sessionId: string; display: number }[],
): DesktopTabPlan {
  const plan: DesktopTabPlan = { open: [], close: [] }

  for (const [sessionId, { desktops }] of sessions) {
    const tabs = tabsOf(sessionId)
    const displays = desktops.map((desktop) => desktop.display)
    const wanted = new Set(displays.map((display) => desktopTabId(sessionId, display)))

    for (const tab of tabs) {
      if (
        tab.active === DESKTOP_PAGE &&
        tab.id.startsWith(`desktop:${sessionId}:`) &&
        !wanted.has(tab.id)
      )
        plan.close.push(tab.id)
    }
  }
  for (const { sessionId, display } of opening) {
    const teamId = sessions.get(sessionId)?.teamId
    const id = desktopTabId(sessionId, display)

    if (teamId && !tabsOf(sessionId).some((tab) => tab.id === id))
      plan.open.push({ sessionId, teamId, display })
  }

  return plan
}
