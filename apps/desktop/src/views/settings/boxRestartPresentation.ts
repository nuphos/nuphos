// A Box's host restarting at the user's request: an update stops the host, installs the
// newest CLI and starts it again (BOX_UPDATE_COMMAND); a resume starts it. While it is
// away the list says the host is offline, so the card follows the restart instead. The
// backend notes an update on the Box (box.updateStartedAt) for every viewer; this window
// also follows its own requests, which covers resumes and older backends.
import { t } from '../../i18n/index.ts'

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
  return kind === 'update' ? t('Updating, restarting…') : t('Resuming…')
}

/** What a restart that ended tells the user; null when the card says enough. */
export function boxRestartEnded(
  kind: BoxRestartKind,
  outcome: BoxRestartOutcome,
  label: string,
  /** A person's computer restarting its Nuphos Desktop, which nobody can Resume from here. */
  desktop = false,
): { tone: 'success' | 'error'; title: string; description: string } | null {
  if (outcome === 'timeout' && desktop)
    return {
      tone: 'error',
      title: t('{label} did not come back', { label }),
      description: t(
        'Nuphos on it has not reconnected 5 minutes after the update started. Open Nuphos on that computer.',
      ),
    }
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

/** The ⋯ menu's Update item, naming the version when it is known. */
export function boxUpdateLabel(version: string): string {
  return version ? t('Update to v{version}', { version }) : t('Update')
}

/** What an update does to the Tasks on a computer: it restarts at once, without waiting for them. */
const updateStopsTasks = () =>
  t(
    'A Task running on it stops where it is, and its other Tasks wait until it reconnects. Send a message to continue a stopped Task.',
  )

/** The confirmation before updating a Box, which restarts Nuphos on it. */
export function boxUpdateConfirm(boxLabel: string, version: string | undefined) {
  const install = version
    ? t(
        'This restarts Nuphos on {boxLabel} now to install the latest version available (expected v{version}).',
        { boxLabel, version },
      )
    : t('This restarts Nuphos on {boxLabel} now to install the latest version available.', {
        boxLabel,
      })

  return {
    title: t('Update {boxLabel}?', { boxLabel }),
    confirmLabel: t('Update and restart'),
    description: `${install} ${t(
      'The computer itself keeps running, and Nuphos on it starts again even if the install fails.',
    )} ${updateStopsTasks()}`,
  }
}

/** The ⋯ menu's item for the viewer's other computer: its Nuphos Desktop's update, when there is one to start. */
export function appUpdateLabel(app: NonNullable<AgentDevice['app']>): string {
  const update = app.update

  if (!update) return t('Up to date')

  return update.ready
    ? t('Update to v{version}', { version: update.version })
    : t('Downloading v{version}', { version: update.version })
}

/** The confirmation before restarting another computer's Nuphos Desktop into its update. */
export function appUpdateConfirm(label: string, version: string) {
  return {
    title: t('Update {boxLabel}?', { boxLabel: label }),
    confirmLabel: t('Update and restart'),
    description: `${t('This restarts Nuphos on {label} now to install v{version}.', {
      label,
      version,
    })} ${updateStopsTasks()}`,
  }
}
