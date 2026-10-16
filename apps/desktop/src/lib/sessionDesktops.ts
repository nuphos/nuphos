// The desktops each conversation on screen holds, read off its runtime snapshot
// by the chat and turned into dock tabs by the workspace: a tab appears when a
// session opens a desktop and goes when the desktop is torn down, the way a
// shell tab follows its PTY. Nothing is persisted; the snapshot is the source.

/** `title` names the machine and the display, e.g. "Box 1 · :3". */
export type SessionDesktop = { display: number; title: string }
export type SessionDesktops = { teamId: string; desktops: SessionDesktop[] }

const DESKTOP_PAGE = 'team.desktop'
const bySession = new Map<string, SessionDesktops>()
const listeners = new Set<() => void>()

export function desktopTabId(sessionId: string, display: number): string {
  return `desktop:${sessionId}:${String(display)}`
}

/** `null` forgets a session whose chat left the screen, without closing its tabs. */
export function publishSessionDesktops(sessionId: string, desktops: SessionDesktops | null): void {
  const before = bySession.get(sessionId)
  const same = desktops
    ? before?.teamId === desktops.teamId &&
      JSON.stringify(before.desktops) === JSON.stringify(desktops.desktops)
    : !before

  if (same) return
  if (desktops) bySession.set(sessionId, desktops)
  else bySession.delete(sessionId)
  for (const notify of listeners) notify()
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

/** The tabs to open and close so every published session's dock shows exactly its desktops. */
export function planDesktopTabs(
  sessions: ReadonlyMap<string, SessionDesktops>,
  tabsOf: (sessionId: string) => readonly { id: string; active: string }[],
): DesktopTabPlan {
  const plan: DesktopTabPlan = { open: [], close: [] }

  for (const [sessionId, { teamId, desktops }] of sessions) {
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
    for (const display of displays) {
      if (!tabs.some((tab) => tab.id === desktopTabId(sessionId, display)))
        plan.open.push({ sessionId, teamId, display })
    }
  }

  return plan
}
