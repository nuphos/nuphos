// The desktops each conversation on screen holds, read off its runtime snapshot
// by the chat and turned into dock tabs by the workspace: a tab appears when a
// session opens a desktop and goes when the desktop is torn down, the way a
// shell tab follows its PTY. Nothing is persisted; the snapshot is the source.

/** `canOpen`: its Box runs a desktop pool, so the owner may open one by hand. */
export type SessionDesktops = { teamId: string; displays: number[]; canOpen?: boolean }

const DESKTOP_PAGE = 'team.desktop'
const bySession = new Map<string, SessionDesktops>()
const listeners = new Set<() => void>()
let focus: { sessionId: string; display: number } | null = null

export function desktopTabId(sessionId: string, display: number): string {
  return `desktop:${sessionId}:${String(display)}`
}

/** `null` forgets a session whose chat left the screen, without closing its tabs. */
export function publishSessionDesktops(sessionId: string, desktops: SessionDesktops | null): void {
  const before = bySession.get(sessionId)
  const same = desktops
    ? before?.teamId === desktops.teamId &&
      String(before.displays) === String(desktops.displays) &&
      before.canOpen === desktops.canOpen
    : !before

  if (same) return
  if (desktops) bySession.set(sessionId, desktops)
  else bySession.delete(sessionId)
  for (const notify of listeners) notify()
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

  for (const [sessionId, { teamId, displays }] of sessions) {
    const tabs = tabsOf(sessionId)
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
