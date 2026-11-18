// The owner updating this computer's Nuphos from another of their computers: the
// tunnel status says which version runs here and which update the updater found,
// and a `method: 'update'` request restarts into it the way Restart to update does.
// It holds to the automatic install's rules (auto-update.ts): never while an agent
// task runs here, and never again into a version whose last install came back old.
//
// Runtime imports stay free of Electron so this loads under plain `node --test`.

import { withAutoInstallRequest } from './cli-auto-update.ts'

import type { AutoInstallPreferences } from '../auto-update.ts'
import type { UpdaterState } from '../updater-state.ts'

export type AppUpdateStatus = {
  version: string
  /** An update the updater found: still downloading, or staged for a restart. */
  update?: { version: string; ready: boolean }
}

export function appUpdateStatus(version: string, state: UpdaterState): AppUpdateStatus {
  if (state.kind === 'downloading')
    return { version, update: { version: state.version, ready: false } }
  if (state.kind === 'ready') return { version, update: { version: state.version, ready: true } }

  return { version }
}

/** Gives the backend's `update` request to the updater, and every other request to `handle`. */
export function withAppUpdate(
  handle: ((request: unknown) => Promise<unknown>) | undefined,
  update: {
    ready: () => { failedBefore: boolean } | null
    /** An agent prompt, command, terminal or Computer Use call is running here. */
    busy: () => boolean
    install: () => void
    /** Lets the answer reach the backend before the app quits. */
    defer?: (run: () => void) => void
  },
): (request: unknown) => Promise<unknown> {
  return (request) => {
    if ((request as { method?: unknown } | null)?.method !== 'update')
      return handle?.(request) ?? Promise.reject(new Error('Instance management unavailable'))
    const ready = update.ready()

    if (!ready) return Promise.reject(new Error('No update is downloaded on this computer yet.'))
    if (ready.failedBefore)
      return Promise.reject(
        new Error('The last update did not install on this computer. Install it there.'),
      )
    if (update.busy())
      return Promise.reject(
        new Error('An agent is working on this computer. Update when it finishes.'),
      )
    const defer = update.defer ?? ((run) => setTimeout(run, 1_000))

    defer(update.install)

    return Promise.resolve({})
  }
}

/**
 * This Desktop's side of its card: the update its updater found and the switch for installing
 * updates by itself (Settings > Updates), in the status, and the requests that act on them.
 */
export function appUpdateTunnel<S extends object>(
  status: () => S,
  instances: ((request: unknown) => Promise<unknown>) | undefined,
  deps: Parameters<typeof withAppUpdate>[1] & {
    version: () => string
    state: () => UpdaterState
    autoInstall: {
      read: () => AutoInstallPreferences
      write: (value: unknown) => AutoInstallPreferences
    }
  },
) {
  return {
    status: () => ({
      ...status(),
      app: appUpdateStatus(deps.version(), deps.state()),
      autoInstall: deps.autoInstall.read().enabled,
    }),
    instances: withAutoInstallRequest(withAppUpdate(instances, deps), deps.autoInstall.write),
  }
}
