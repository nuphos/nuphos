// The owner updating this computer's Nuphos from another of their computers: the
// tunnel status says which version runs here and which update the updater found,
// and a `method: 'update'` request restarts into it the way Restart to update does.
// Unlike the automatic install (auto-update.ts) it does not wait for running Tasks: the
// owner asked for the restart, and a turn it ends shows its computer disconnected. It
// still never restarts again into a version whose last install came back old.
//
// Runtime imports stay free of Electron so this loads under plain `node --test`.

import pkg from '../../../package.json' with { type: 'json' }

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
    /** The status changed: the card shows the switch as it now is. */
    changed: () => void
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
    instances: withAutoInstallRequest(
      withAppUpdate(instances, deps),
      deps.autoInstall.write,
      deps.changed,
    ),
  }
}

export type Instances = (request: unknown) => Promise<unknown>
type CreateTunnel<R, S, C, T> = (
  runtime: R,
  status: () => S,
  onChange: C,
  instances?: Instances,
) => T

/**
 * The e2e suite's stand-in for an update a Nuphos Desktop downloaded (scripts/e2e/second-computer.ts):
 * with NUPHOS_E2E_STAGED_UPDATE set, `nuphos agent` reports that version staged, and its owner's
 * Update runs `install`, as the Desktop quits to install it. Unset, the tunnel is made as before.
 */
export function withE2eStagedUpdate<R, S, C, T>(
  install: () => void,
  create: CreateTunnel<R, S, C, T>,
  version = process.env.NUPHOS_E2E_STAGED_UPDATE,
): CreateTunnel<R, S, C, T> {
  if (!version) return create
  // This build's own version: one older than 0.133.2 is not offered the restart.
  const app: AppUpdateStatus = { version: pkg.version, update: { version, ready: true } }

  return (runtime, status, onChange, instances) =>
    create(
      runtime,
      () => ({ ...status(), app }),
      onChange,
      withAppUpdate(instances, { ready: () => ({ failedBefore: false }), install }),
    )
}
