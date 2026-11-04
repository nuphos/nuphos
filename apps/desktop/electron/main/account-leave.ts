import { BrowserWindow } from 'electron'

import { resetAnalyticsUser } from '../analytics'
import { commitConfigIf } from '../auth/config.ts'
import { authSession } from '../auth-session.ts'
import * as k8s from '../k8s'
import * as podExec from '../pod-exec'
import * as terminal from '../terminal'

import { followAccount } from './account-leave-core.ts'

let reloadWaiters = new Set<() => void>()

/**
 * Resolves once the windows start reloading as the next account. Taken before
 * a switch, so work for the next account (a link to open) waits for its page
 * rather than reaching the one about to go; `cancel` if the switch did not happen.
 */
export function nextReload(): { reloaded: Promise<void>; cancel: () => void } {
  let resolve!: () => void
  const reloaded = new Promise<void>((r) => {
    resolve = r
  })

  reloadWaiters.add(resolve)

  return { reloaded, cancel: () => reloadWaiters.delete(resolve) }
}

/** Reloads every window as the account now in use, and tells whoever waits for it. */
export function reloadWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.reload()
  }
  const waiters = reloadWaiters

  reloadWaiters = new Set()
  for (const resolve of waiters) resolve()
}

// Wires leaving an account to the app (account-leave-core.ts), once, as
// main.ts loads.
followAccount(authSession, {
  settled: () =>
    commitConfigIf(
      () => true,
      () => Promise.resolve(null),
    ),
  teardown: () => {
    k8s.stopAllPortForwards()
    terminal.closeAllSshSessions()
    // Closes exec sessions and deletes any node-shell pods.
    podExec.closeAllPodExecSessions()
    resetAnalyticsUser()
  },
  reload: reloadWindows,
})
