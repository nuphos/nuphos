// A conversation on a Box may hold a desktop there (one X display per session,
// see the host's desktop-session.mjs). The host reports them in its tunnel
// status; this folds the conversation's own into its runtime snapshot as a
// tool entry, so clients show it the way they show a running shell. Nothing is
// stored: when the desktop goes, so does the entry.

import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { getAgentDevice } from '@/lib/agent/devices/store'

import type { SessionExecutionState } from './runtime-execution-snapshot'

export type DesktopOwner = { sessionId: string; runtimeId?: string | null }
type DeviceLabel = (userId: string, deviceId: string) => Promise<string | undefined>

const storedLabel: DeviceLabel = async (userId, deviceId) =>
  (await getAgentDevice(userId, deviceId))?.label

/** The conversation's desktops, and whether its Box runs a desktop pool it could open one from. */
export type SessionDesktops = {
  tools: NonNullable<SessionExecutionState['tools']>
  canOpen: boolean
}

const NONE: SessionDesktops = { tools: [], canOpen: false }

/** Each entry's title names the machine and the display, e.g. "Box 1 · :3". */
export async function sessionDesktops(
  conversation: DesktopOwner,
  deviceLabel = storedLabel,
): Promise<SessionDesktops> {
  const ref = conversation.runtimeId ? parseLocalRuntimeId(conversation.runtimeId) : undefined

  if (!ref) return NONE
  // A host reports `desktops` only where it runs a desktop pool, and `desktopOpen`
  // only from the bundle that opens one on request; older Boxes show no entry.
  const status = (await runtimePresenceStore().get(ref.userId, ref.deviceId))?.status
  const canOpen = status?.desktopOpen === true
  const desktops = (status?.desktops ?? []).filter(
    (desktop) => desktop.sessionId === conversation.sessionId,
  )

  if (!desktops.length) return { tools: [], canOpen }
  const label = (await deviceLabel(ref.userId, ref.deviceId)) ?? 'Desktop'

  return {
    canOpen,
    tools: desktops.map((desktop) => ({
      id: `desktop:${String(desktop.display)}`,
      kind: 'desktop',
      title: `${label} · :${String(desktop.display)}`,
      status: 'running',
      desktop: { display: desktop.display, deviceId: ref.deviceId },
    })),
  }
}

/** The snapshot with the conversation's desktops appended; unchanged when it has none and can open none. */
export function withDesktops<T extends SessionExecutionState>(
  snapshot: T,
  { tools, canOpen }: SessionDesktops,
): T {
  if (!canOpen && !tools.length) return snapshot

  return {
    ...snapshot,
    ...(canOpen && { canOpenDesktop: true }),
    ...(tools.length && { tools: [...(snapshot.tools ?? []), ...tools] }),
  }
}

export async function withSessionDesktops<T extends SessionExecutionState>(
  snapshot: T,
  conversation: DesktopOwner,
  deviceLabel = storedLabel,
): Promise<T> {
  return withDesktops(snapshot, await sessionDesktops(conversation, deviceLabel))
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
