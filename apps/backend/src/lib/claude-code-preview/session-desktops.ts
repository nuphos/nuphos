// A conversation on a Box may hold a desktop there (one X display per session,
// see the host's desktop-session.mjs). The host reports them in its tunnel
// status; this folds the conversation's own into its runtime snapshot as a
// tool entry, so clients show it the way they show a running shell. Nothing is
// stored: when the desktop goes, so does the entry.

import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'

import type { SessionExecutionState } from './runtime-execution-snapshot'

export type DesktopOwner = { sessionId: string; runtimeId?: string | null }

export async function sessionDesktops(
  conversation: DesktopOwner,
): Promise<NonNullable<SessionExecutionState['tools']>> {
  const ref = conversation.runtimeId ? parseLocalRuntimeId(conversation.runtimeId) : undefined

  if (!ref) return []
  const presence = await runtimePresenceStore().get(ref.userId, ref.deviceId)

  return (presence?.status?.desktops ?? [])
    .filter((desktop) => desktop.sessionId === conversation.sessionId)
    .map((desktop) => ({
      id: `desktop:${String(desktop.display)}`,
      kind: 'desktop',
      title: 'Desktop',
      status: 'running',
      desktop: { display: desktop.display, deviceId: ref.deviceId },
    }))
}

/** The snapshot with the conversation's desktops appended; unchanged when it has none. */
export async function withSessionDesktops<T extends SessionExecutionState>(
  snapshot: T,
  conversation: DesktopOwner,
): Promise<T> {
  const desktops = await sessionDesktops(conversation)

  return desktops.length
    ? { ...snapshot, tools: [...(snapshot.tools ?? []), ...desktops] }
    : snapshot
}

/**
 * For a running turn, whose snapshots arrive synchronously: the last known
 * desktops, refreshed in the background on each use. The first frame after a
 * desktop appears may miss it; the next one carries it.
 */
export function desktopTracker(conversation: DesktopOwner) {
  let known: NonNullable<SessionExecutionState['tools']> = []
  let refreshing: Promise<void> | undefined

  return {
    with<T extends SessionExecutionState>(snapshot: T): T {
      refreshing ??= sessionDesktops(conversation)
        .then((desktops) => {
          known = desktops
        })
        .catch(() => undefined)
        .finally(() => {
          refreshing = undefined
        })

      return known.length ? { ...snapshot, tools: [...(snapshot.tools ?? []), ...known] } : snapshot
    },
  }
}
