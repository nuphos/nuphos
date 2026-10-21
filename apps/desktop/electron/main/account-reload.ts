import { BrowserWindow } from 'electron'

import { accountOf } from '../account-context'
import { accountContext, onLoginApiUrlChange } from '../api-endpoint'

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
 * account, signing out) reloads every window, so none keeps showing it. The
 * account context has already ended what belonged to the account left.
 */
export function watchAccountChanges(): void {
  accountContext.subscribe((next, prev, reason) => {
    const left = accountOf(prev)

    if (left === null || left === accountOf(next)) {
      // Signing in again to the account shown replaces its token, which ends
      // the runtime sessions bound to it: reload so the windows reconnect.
      if (reason === 'signIn' && prev.token !== null && next.token !== null)
        reloadAppWindows('added')

      return
    }
    if (reason === 'signIn') reloadAppWindows('added')
    else reloadAppWindows(next.token === null ? 'signedOut' : 'switched')
  })

  // Every window adding an account shows the server its sign-in will go to.
  onLoginApiUrlChange((url) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('auth:loginEndpointChanged', url)
    }
  })
}
