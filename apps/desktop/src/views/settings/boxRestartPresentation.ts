// A Box's host restarting at the user's request: an update stops the host, installs the
// newest CLI and starts it again (BOX_UPDATE_COMMAND); a resume starts it. While it is
// away the list says the host is offline, so the card follows the restart instead. The
// backend notes an update on the Box (box.updateStartedAt) for every viewer; this window
// also follows its own requests, which covers resumes and older backends.
import { t } from '../../i18n/index.ts'

import type { AgentDevice } from '../../api/device-types'

export type BoxRestartKind = 'update' | 'resume' | 'resize'

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
// A resize stops the machine before it starts again, so it gets the backend's longer window.
export const BOX_RESIZE_TIMEOUT_MS = 10 * 60_000

/** Whether the Box is back from the restart; an update or resize once the backend is done too. */
function restartDone(kind: BoxRestartKind, device: AgentDevice, left: boolean): boolean {
  const online = device.online === true

  if (kind === 'resume') return online
  if (kind === 'update') return online && left && !device.box?.updateStartedAt

  // A failed resize is over as well; the toast says why.
  return left && !device.box?.resizeStartedAt && (online || Boolean(device.box?.resizeError))
}

/** Where a restart stands after a fresh list: back once its host is online again. */
export function boxRestartStep(
  restart: BoxRestart,
  device: AgentDevice | undefined,
  now = Date.now(),
): { restart: BoxRestart; outcome: BoxRestartOutcome } {
  if (!device) return { restart, outcome: 'gone' }
  const next = { ...restart, sawOffline: restart.sawOffline || device.online !== true }
  const elapsed = now - restart.startedAt
  // The host left and returned, or one still online well after the request restarted unseen.
  const left = next.sawOffline || elapsed > BOX_RESTART_MISSED_MS
  const timeout = restart.kind === 'resize' ? BOX_RESIZE_TIMEOUT_MS : BOX_RESTART_TIMEOUT_MS

  if (restartDone(restart.kind, device, left)) return { restart: next, outcome: 'back' }

  return { restart: next, outcome: elapsed > timeout ? 'timeout' : 'restarting' }
}

/** The restart a card shows: this window's own, else an update or resize the backend reports. */
export function boxRestartOf(
  own: BoxRestart | undefined,
  device: AgentDevice,
): BoxRestart | undefined {
  const update = device.box?.updateStartedAt
  const resize = device.box?.resizeStartedAt

  if (own) return own
  if (update) return { kind: 'update', startedAt: Date.parse(update), sawOffline: false }

  return resize ? { kind: 'resize', startedAt: Date.parse(resize), sawOffline: false } : undefined
}

const RESTART_LABEL: Record<BoxRestartKind, () => string> = {
  update: () => t('Updating, restarting…'),
  resume: () => t('Resuming…'),
  resize: () => t('Resizing, restarting…'),
}

/** The card's status while its host restarts. */
export function boxRestartLabel(kind: BoxRestartKind): string {
  return RESTART_LABEL[kind]()
}

/** What a restart that ended tells the user; null when the card says enough. */
export function boxRestartEnded(
  kind: BoxRestartKind,
  outcome: BoxRestartOutcome,
  label: string,
  resizeError?: string,
): { tone: 'success' | 'error'; title: string; description: string } | null {
  if (kind === 'resize') return boxResizeEnded(outcome, label, resizeError)
  if (outcome === 'timeout')
    return {
      tone: 'error',
      title: t('{label} did not come back', { label }),
      description:
        kind === 'update'
          ? t(
              'Its host has not reconnected 5 minutes after the update started. Resume it to start the host again.',
            )
          : t('Its host has not reconnected 5 minutes after resuming. Try Resume again.'),
    }
  if (outcome === 'back' && kind === 'update')
    return {
      tone: 'success',
      title: t('{label} is back', { label }),
      description: t('Its runtimes are available again.'),
    }

  return null
}

function boxResizeEnded(outcome: BoxRestartOutcome, label: string, error: string | undefined) {
  if (outcome === 'back' && error)
    return {
      tone: 'error' as const,
      title: t('Could not resize {label}', { label }),
      description: error,
    }
  if (outcome === 'back')
    return {
      tone: 'success' as const,
      title: t('{label} was resized', { label }),
      description: t('It runs at its new size.'),
    }
  if (outcome === 'timeout')
    return {
      tone: 'error' as const,
      title: t('{label} did not come back', { label }),
      description: t('It has not reconnected 10 minutes after the resize started. Try Resume.'),
    }

  return null
}

/** The ⋯ menu's Update item, naming the version when it is known. */
export function boxUpdateLabel(version: string): string {
  return version ? t('Update to v{version}', { version }) : t('Update')
}

/** The confirmation before updating a Box's agents, which restarts its agent host. */
export function boxUpdateConfirm(boxLabel: string, version: string | undefined) {
  const install = version
    ? t(
        'This restarts the runtime host on {boxLabel} to install the latest version available now (expected v{version}).',
        { boxLabel, version },
      )
    : t(
        'This restarts the runtime host on {boxLabel} to install the latest version available now.',
        { boxLabel },
      )

  return {
    title: t('Update {boxLabel}?', { boxLabel }),
    confirmLabel: t('Update and restart'),
    description: `${install} ${t(
      'The computer itself keeps running, but all of its runtimes are unavailable until the host reconnects. The host starts again even if the install fails. The update does not start while any agent on it is replying.',
    )}`,
  }
}
