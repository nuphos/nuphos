// Installing a downloaded update by itself, at a moment nobody would notice the
// restart: no agent task runs on this computer and nobody has used it for a
// while. A computer shared with a team keeps current without anyone pressing
// Restart. Off unless its owner turns it on.
//
// Runtime imports stay free of Electron so this loads under plain `node --test`.

/** How long nobody may have touched the keyboard or mouse before the restart. */
export const AUTO_INSTALL_IDLE_SECONDS = 10 * 60

export const AUTO_INSTALL_CHECK_MS = 60_000

export type AutoInstallPreferences = { enabled: boolean }

export const DEFAULT_AUTO_INSTALL: AutoInstallPreferences = { enabled: false }

export function parseAutoInstall(value: unknown): AutoInstallPreferences {
  const enabled = (value as { enabled?: unknown } | null)?.enabled

  if (typeof enabled !== 'boolean') throw new Error('Invalid automatic update preferences')

  return { enabled }
}

export type AutoInstallSignals = {
  enabled: boolean
  /** An update is downloaded and waiting for a restart. */
  ready: boolean
  /** The last restart came back on the old version: retrying alone could loop. */
  failedBefore: boolean
  /** An agent prompt, command, terminal or Computer Use call is running here. */
  busy: boolean
  /** Seconds since the last keyboard or mouse input. */
  idleSeconds: number
}

export function shouldAutoInstall(
  signals: AutoInstallSignals,
  idleSeconds = AUTO_INSTALL_IDLE_SECONDS,
): boolean {
  return (
    signals.enabled &&
    signals.ready &&
    !signals.failedBefore &&
    !signals.busy &&
    signals.idleSeconds >= idleSeconds
  )
}

/** `NUPHOS_AUTO_UPDATE_IDLE_SECONDS` shortens the wait for testing; never below 30 s. */
export function idleThreshold(env: NodeJS.ProcessEnv): number {
  const seconds = Number(env.NUPHOS_AUTO_UPDATE_IDLE_SECONDS)

  return Number.isFinite(seconds) && seconds > 0
    ? Math.max(30, Math.floor(seconds))
    : AUTO_INSTALL_IDLE_SECONDS
}
