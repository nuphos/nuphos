import { BrowserWindow, dialog } from 'electron'

import type { WebContents } from 'electron'

// Native, main-process consent for the highest-risk ("Tier 0") IPC actions —
// the ones whose blast radius is node/cluster root. A renderer-side React
// confirm is NOT a security boundary: a compromised/rogue renderer can call
// the dangerous IPC directly, skipping any in-app dialog. `dialog.showMessageBox`
// is initiated and resolved entirely in the main process and the OS renders it,
// so the renderer has no API to auto-dismiss it — that is the actual boundary.
//
// One dialog per call, deliberately: each dangerous operation must carry its
// own consent. We do NOT coalesce concurrent calls — sharing one answer across
// callers would let a single confirmation authorize several operations (and,
// with payload-independent keys, operations the user never saw). The renderer
// is responsible for not firing duplicate requests for one user action (e.g.
// the terminal defers its start so StrictMode's throwaway mount never calls in).
//
// The threat model deliberately scopes this to Tier 0 only (rare,
// deliberate actions) rather than every mutating channel.

export { dangerousManifestReason } from './manifest-risk'

export async function requireNativeConsent(
  sender: WebContents,
  opts: { title: string; message: string; detail?: string; confirmLabel: string },
): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(sender)
  const args = {
    type: 'warning' as const,
    buttons: ['Cancel', opts.confirmLabel],
    // Default to Cancel so a stray Enter/Return can't confirm a dangerous
    // action, and so the safe choice is the one the OS pre-selects.
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: opts.title,
    message: opts.message,
    detail: opts.detail,
  }
  const { response } = win
    ? await dialog.showMessageBox(win, args)
    : await dialog.showMessageBox(args)

  return response === 1
}
