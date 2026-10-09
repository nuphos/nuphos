import { BrowserWindow } from 'electron'

import { showAppDialog } from './app-dialog.ts'

import type { WebContents } from 'electron'

// Main-process consent remains isolated from the requesting app renderer.
// Every operation gets its own script-free modal with no app preload or IPC.
export { dangerousManifestReason } from './manifest-risk'

export function requireMainProcessConsent(
  sender: WebContents,
  opts: { title: string; message: string; detail?: string; confirmLabel: string },
): Promise<boolean> {
  if (sender.isDestroyed()) return Promise.resolve(false)
  const parent = BrowserWindow.fromWebContents(sender)

  if (!parent) return Promise.resolve(false)

  return showAppDialog(parent, opts)
}
