// This Mac's own screen (mac-screen.ts) as the app wires it: the tunnel's deps,
// the "Let my phone see and control this Mac" setting, and the notice shown
// while a phone has control.

import path from 'node:path'

import { Notification } from 'electron'

import {
  enableMacScreen,
  macScreenAllowed,
  macScreenDeps,
  setMacScreenAllowed,
} from './mac-screen.ts'

import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'

/** Whoever sits at this Mac sees when their phone takes it over. */
function announceControl(human: boolean): void {
  if (!human || !Notification.isSupported()) return
  new Notification({
    title: 'This Mac is controlled from your phone',
    body: 'Nuphos on your phone took over this screen. It stops when the phone hands it back or closes the desktop.',
  }).show()
}

/** Everything is a no-op off a Mac. `changed` runs when the screen changes hands or the setting changes. */
export function macScreenApp(dataDir: string, bundleRoot: () => string, changed: () => void) {
  const pool = enableMacScreen(dataDir, changed)
  const handOver = announceControl
  const binary = () => path.join(bundleRoot(), 'mac-screen-host')

  return {
    deps: (
      status: () => LocalRuntimeTunnelStatus,
      instances?: (request: unknown) => Promise<unknown>,
    ) => (pool ? macScreenDeps(pool, status, { binary, handOver }, instances) : {}),
    state: () => (pool ? { phoneControl: macScreenAllowed(pool) } : {}),
    /** Only this Mac's own settings call it. */
    set: (allowed: boolean): boolean => {
      if (!pool) return false
      setMacScreenAllowed(pool, allowed)
      changed()

      return allowed
    },
  }
}
