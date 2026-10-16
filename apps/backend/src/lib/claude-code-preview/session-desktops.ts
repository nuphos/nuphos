// A conversation on a Box may hold a desktop there (one X display per session,
// see the host's desktop-session.mjs). The host reports them in its tunnel
// status; this folds the conversation's own into its runtime snapshot as a
// tool entry, so clients show it the way they show a running shell. Nothing is
// stored: when the desktop goes, so does the entry.

import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'

import type { SessionExecutionState } from './runtime-execution-snapshot'

export type DesktopOwner = { sessionId: string; runtimeId?: string | null }

/** The conversation's desktops, and whether its Box runs a desktop pool it could open one from. */
export type SessionDesktops = {
  tools: NonNullable<SessionExecutionState['tools']>
  canOpen: boolean
}

const NONE: SessionDesktops = { tools: [], canOpen: false }

export async function sessionDesktops(conversation: DesktopOwner): Promise<SessionDesktops> {
  const ref = conversation.runtimeId ? parseLocalRuntimeId(conversation.runtimeId) : undefined

  if (!ref) return NONE
  // A host reports `desktops` only where it runs a desktop pool.
  const desktops = (await runtimePresenceStore().get(ref.userId, ref.deviceId))?.status?.desktops

  if (!desktops) return NONE

  return {
    canOpen: true,
    tools: desktops
      .filter((desktop) => desktop.sessionId === conversation.sessionId)
      .map((desktop) => ({
        id: `desktop:${String(desktop.display)}`,
        kind: 'desktop',
        title: 'Desktop',
        status: 'running',
        desktop: { display: desktop.display, deviceId: ref.deviceId },
      })),
  }
}

/** The snapshot with the conversation's desktops appended; unchanged when its Box has no pool. */
export function withDesktops<T extends SessionExecutionState>(
  snapshot: T,
  { tools, canOpen }: SessionDesktops,
): T {
  if (!canOpen) return snapshot

  return {
    ...snapshot,
    canOpenDesktop: true,
    ...(tools.length && { tools: [...(snapshot.tools ?? []), ...tools] }),
  }
}

export async function withSessionDesktops<T extends SessionExecutionState>(
  snapshot: T,
  conversation: DesktopOwner,
): Promise<T> {
  return withDesktops(snapshot, await sessionDesktops(conversation))
}

/**
 * For a running turn, whose snapshots arrive synchronously: the last known
 * desktops, refreshed in the background on each use. The first frame after a
 * desktop appears may miss it; the next one carries it.
 */
export function desktopTracker(conversation: DesktopOwner) {
  let known = NONE
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

      return withDesktops(snapshot, known)
    },
  }
}
