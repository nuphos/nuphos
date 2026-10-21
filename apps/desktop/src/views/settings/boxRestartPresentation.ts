// A Box's host restarting at the user's request: an update stops the host, installs the
// newest CLI and starts it again (BOX_UPDATE_COMMAND); a resume starts it. While it is
// away the list says the host is offline, so the card follows the restart instead. The
// backend notes an update on the Box (box.updateStartedAt) for every viewer; this window
// also follows its own requests, which covers resumes and older backends.
import type { AgentDevice } from '../../api/device-types'

export type BoxRestartKind = 'update' | 'resume'

export type BoxRestart = {
  kind: BoxRestartKind
  startedAt: number
  /** Whether the list has shown the host away since the request. */
  sawOffline: boolean
}

export type BoxRestartOutcome = 'restarting' | 'back' | 'timeout' | 'gone'

// A host that has not come back after this long will not on its own; the backend's window too.
export const BOX_RESTART_TIMEOUT_MS = 5 * 60_000
// The update waits up to 30 s for the host to stop; one still online well after that
// restarted between two readings.
export const BOX_RESTART_MISSED_MS = 90_000

/** Where a restart stands after a fresh list: back once its host is online again. */
export function boxRestartStep(
  restart: BoxRestart,
  device: AgentDevice | undefined,
  now = Date.now(),
): { restart: BoxRestart; outcome: BoxRestartOutcome } {
  if (!device) return { restart, outcome: 'gone' }
  const online = device.online === true
  const next = { ...restart, sawOffline: restart.sawOffline || !online }
  const elapsed = now - restart.startedAt
  // An update is back once the host left and returned; the backend says so when it knows.
  const updated =
    !device.box?.updateStartedAt && (next.sawOffline || elapsed > BOX_RESTART_MISSED_MS)

  if (online && (restart.kind === 'resume' || updated)) return { restart: next, outcome: 'back' }

  return { restart: next, outcome: elapsed > BOX_RESTART_TIMEOUT_MS ? 'timeout' : 'restarting' }
}

/** The restart a card shows: this window's own, else an update the backend reports. */
export function boxRestartOf(
  own: BoxRestart | undefined,
  device: AgentDevice,
): BoxRestart | undefined {
  const since = device.box?.updateStartedAt

  return (
    own ?? (since ? { kind: 'update', startedAt: Date.parse(since), sawOffline: false } : undefined)
  )
}

/** The card's status while its host restarts. */
export function boxRestartLabel(kind: BoxRestartKind): string {
  return kind === 'update' ? 'Updating, restarting…' : 'Resuming…'
}

/** What a restart that ended tells the user; null when the card says enough. */
export function boxRestartEnded(
  kind: BoxRestartKind,
  outcome: BoxRestartOutcome,
  label: string,
): { tone: 'success' | 'error'; title: string; description: string } | null {
  if (outcome === 'timeout')
    return {
      tone: 'error',
      title: `${label} did not come back`,
      description:
        kind === 'update'
          ? 'Its host has not reconnected 5 minutes after the update started. Resume it to start the host again.'
          : 'Its host has not reconnected 5 minutes after resuming. Try Resume again.',
    }
  if (outcome === 'back' && kind === 'update')
    return {
      tone: 'success',
      title: `${label} is back`,
      description: 'Its agents are available again.',
    }

  return null
}

/** The confirmation before updating a Box's agents, which restarts its agent host. */
export function boxUpdateConfirm(boxLabel: string, version: string | undefined) {
  const expected = version ? ` (expected v${version})` : ''

  return {
    title: `Update ${boxLabel}?`,
    confirmLabel: 'Update and restart',
    description: `This restarts the agent host on ${boxLabel} to install the latest version available now${expected}. The Box itself keeps running, but all of its agents are unavailable until the host reconnects. The host starts again even if the install fails. The update does not start while any of its agents is replying.`,
  }
}

/** What Update does: a Box agent asks first, since it restarts the whole host; others start. */
export function updateAction(box: string | undefined, version: string | undefined) {
  return box === undefined
    ? ({ confirm: null } as const)
    : { confirm: boxUpdateConfirm(box, version) }
}
