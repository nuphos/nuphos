// This computer's own screen (mac-screen.ts) as the app wires it: the tunnel's deps
// and the notice shown while a phone has control.

import { Notification, systemPreferences } from 'electron'

import { t } from '../i18n.ts'

import { enableMacScreen, macScreenDeps, screenHost } from './mac-screen.ts'

import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'

/** Whoever sits at this computer sees when their phone takes it over. */
function announceControl(human: boolean): void {
  if (!human || !Notification.isSupported()) return
  new Notification({
    title: t('This computer is controlled from your phone'),
    body: t(
      'Nuphos on your phone took over this screen. It stops when the phone hands it back or closes the desktop.',
    ),
  }).show()
}

/** macOS's own prompt, with a button to Settings: without Accessibility the host does not start. */
function askAccessibility(): void {
  systemPreferences.isTrustedAccessibilityClient(true)
}

/** No deps where there is no screen to hand over. `changed` runs when the screen changes hands. */
export function macScreenApp(dataDir: string, bundleRoot: () => string, changed: () => void) {
  const pool = enableMacScreen(dataDir, changed)
  const handOver = announceControl
  const binary = () => screenHost(bundleRoot())
  // Only macOS asks for Accessibility; X11 needs nothing granted.
  const ask = process.platform === 'darwin' ? askAccessibility : undefined

  return {
    deps: (
      status: () => LocalRuntimeTunnelStatus,
      /** The account signed in here: the only one whose phone may open the screen. */
      owner: () => string | null,
      instances?: (request: unknown) => Promise<unknown>,
    ) => (pool ? macScreenDeps(pool, status, { binary, handOver, owner, ask }, instances) : {}),
  }
}
