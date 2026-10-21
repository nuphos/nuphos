import { BrowserWindow } from 'electron'

import { endAccountWork } from '../account-work'
import { resetAnalyticsUser } from '../analytics'
import { apiUrl, onLoginApiUrlChange } from '../api-endpoint'
import { shownAccount } from '../auth/shown-account'
import { signInCommitting } from '../auth/sign-in'
import { authSession } from '../auth-session'
import * as podExec from '../pod-exec'
import * as terminal from '../terminal'

import {
  mostRecentlyFocusedAppWindow,
  mostRecentlyFocusedVisibleAppWindow,
  openAppWindows,
} from './windows'

/** How the signed-in account changed, passed to reloaded windows as `?account=`. */
export type AccountChangeKind = 'added' | 'switched' | 'signedOut'

/** The window's address with the account change it reloads for. */
export function withAccountChange(current: string, change: AccountChangeKind): string {
  const url = new URL(current)

  url.searchParams.set('account', change)

  return url.toString()
}

/**
 * Reloads every app window as the account it now shows, telling each how it
 * changed. A sign-in is told to one window only, the one most likely to have
 * made it, so it is counted once; the others reload as for a switch.
 */
export function reloadAppWindows(change: AccountChangeKind): void {
  // Every window may be hidden or minimized by the time a sign-in saves.
  const signedInFrom =
    change === 'added'
      ? (mostRecentlyFocusedVisibleAppWindow() ?? mostRecentlyFocusedAppWindow())
      : null

  for (const win of openAppWindows()) {
    const told = change === 'added' && win !== signedInFrom ? 'switched' : change

    win.loadURL(withAccountChange(win.webContents.getURL(), told)).catch((e: unknown) => {
      console.warn('failed to reload a window after an account change', e)
    })
  }
}

/**
 * Any change away from the account the windows show (a switch, adding an
 * account, signing out) reloads every window, so none keeps showing it.
 */
export function watchAccountChanges(): void {
  const movedFromShown = shownAccount(apiUrl, authSession.current())

  authSession.subscribe((next, prev) => {
    const signingIn = signInCommitting()

    if (!movedFromShown(next)) {
      // Signing in again to the account shown replaces its token, which ends
      // the runtime sessions bound to it: reload so the windows reconnect.
      if (signingIn && prev !== null && next !== null) reloadAppWindows('added')

      return
    }
    // SSH and pod-exec sessions outlive a renderer reload by design; the
    // account they were opened as is leaving, so close them (and any
    // node-shell pod) here rather than in the window that made the change.
    // Starts still fetching credentials or probing for the account leaving are refused too.
    endAccountWork()
    terminal.closeAllSshSessions()
    podExec.closeAllPodExecSessions()
    resetAnalyticsUser()
    // A sign-in on another backend clears the session before its token takes
    // effect, so it is checked for before treating the change as a sign-out.
    const change = next === null ? 'signedOut' : 'switched'

    reloadAppWindows(signingIn ? 'added' : change)
  })

  // Every window adding an account shows the server its sign-in will go to.
  onLoginApiUrlChange((url) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('auth:loginEndpointChanged', url)
    }
  })
}
