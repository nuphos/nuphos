// The desktops each conversation on screen holds, read off its runtime snapshot
// by the chat. A desktop's dock tab opens only when the user asks for it (New
// Tab → Desktop or the Box switcher) and goes when the desktop is torn down.
// Nothing is persisted; the snapshot is the source.

/** `title` names the machine and the display, e.g. "Box 1 · :3"; `deviceId` is that machine. */
export type SessionDesktop = { display: number; title: string; deviceId?: string }
/** `canOpen`: the owner may open one by hand, its Box running a desktop pool or the session holding one. */
export type SessionDesktops = { teamId: string; desktops: SessionDesktop[]; canOpen?: boolean }

const DESKTOP_PAGE = 'team.desktop'
const bySession = new Map<string, SessionDesktops>()
const listeners = new Set<() => void>()
let focus: { sessionId: string; display: number } | null = null

export function desktopTabId(sessionId: string, display: number): string {
  return `desktop:${sessionId}:${String(display)}`
}

/** The session whose display a `desktopTabId` tab shows. */
export function desktopTabSession(tabId: string): string | undefined {
  return /^desktop:(.+):\d+$/u.exec(tabId)?.[1]
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

/** The title the session's snapshot gives a display, while it still holds it. */
export function sessionDesktopTitle(sessionId: string, display: number): string | undefined {
  return bySession.get(sessionId)?.desktops.find((desktop) => desktop.display === display)?.title
}

/** The machine whose display it is, while the session still holds it. */
export function sessionDesktopDevice(sessionId: string, display: number): string | undefined {
  return bySession.get(sessionId)?.desktops.find((desktop) => desktop.display === display)?.deviceId
}

export type DesktopTabPlan = {
  open: { sessionId: string; teamId: string; display: number }[]
  close: string[]
}

/** A tab for the `asked` desktop if it has none, and the tabs whose desktop is gone. */
export function planDesktopTabs(
  sessions: ReadonlyMap<string, SessionDesktops>,
  tabsOf: (sessionId: string) => readonly { id: string; active: string }[],
  asked: { sessionId: string; display: number } | null,
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
  if (asked) {
    const { sessionId, display } = asked
    const teamId = sessions.get(sessionId)?.teamId
    const id = desktopTabId(sessionId, display)

    if (teamId && !tabsOf(sessionId).some((tab) => tab.id === id))
      plan.open.push({ sessionId, teamId, display })
  }

  return plan
}
