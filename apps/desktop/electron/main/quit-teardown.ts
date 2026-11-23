import type { App } from 'electron'

/**
 * Runs `teardown` once a quit is certain, holding the exit until it settles.
 * Only will-quit is certain: after before-quit a window can still cancel the
 * quit, and the app then lives on with whatever the teardown stopped (its
 * runtime, and with it the computer's presence).
 */
export function teardownOnQuit(
  app: Pick<App, 'on' | 'quit'>,
  teardown: () => Promise<unknown>,
): void {
  let tornDown = false

  app.on('will-quit', (event) => {
    if (tornDown) return
    tornDown = true
    event.preventDefault()
    // Electron drops a quit asked for while will-quit is still being dispatched, and a
    // teardown with nothing to wait for settles before that dispatch ends: quit on the
    // next turn of the event loop, or the app lingers windowless and never exits (#4524).
    void teardown().finally(() => setImmediate(() => app.quit()))
  })
}
