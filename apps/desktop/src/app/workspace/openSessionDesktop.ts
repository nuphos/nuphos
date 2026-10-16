import {
  focusSessionDesktop,
  publishSessionDesktops,
  readSessionDesktops,
} from '../../lib/sessionDesktops.ts'

/**
 * Opens the conversation's desktop by hand: the Box claims one through the pool
 * the agent's desktop tool uses, unless the session already holds one, and
 * syncDesktopTabs opens and focuses its tab. Publishing the answered display
 * opens the tab before the next runtime snapshot carries it.
 */
export async function openSessionDesktop(
  teamId: string,
  sessionId: string,
  request: (teamId: string, sessionId: string) => Promise<{ display: number }>,
): Promise<void> {
  let display = readSessionDesktops().get(sessionId)?.desktops[0]?.display

  if (display === undefined) {
    display = (await request(teamId, sessionId)).display
    const known = readSessionDesktops().get(sessionId)

    if (known && !known.desktops.some((desktop) => desktop.display === display))
      publishSessionDesktops(sessionId, {
        ...known,
        desktops: [...known.desktops, { display, title: `:${String(display)}` }],
      })
  }
  focusSessionDesktop(sessionId, display)
}
