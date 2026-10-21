import { openAppWindows } from './windows'

/** How the signed-in account changed, passed to reloaded windows as `?account=`. */
export type AccountChangeKind = 'added' | 'switched' | 'signedOut'

/** The window's address with the account change it reloads for. */
export function withAccountChange(current: string, change: AccountChangeKind): string {
  const url = new URL(current)

  url.searchParams.set('account', change)

  return url.toString()
}

/** Reloads every app window as the account it now shows, telling each how it changed. */
export function reloadAppWindows(change: AccountChangeKind): void {
  for (const win of openAppWindows()) {
    win.loadURL(withAccountChange(win.webContents.getURL(), change)).catch((e: unknown) => {
      console.warn('failed to reload a window after an account change', e)
    })
  }
}
