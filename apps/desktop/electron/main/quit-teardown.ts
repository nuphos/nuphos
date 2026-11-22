import type { App } from 'electron'

/**
 * Runs `teardown` once a quit is certain, holding the exit until it settles.
 * Only will-quit is certain: after before-quit a window can still cancel the
 * quit, and the app then lives on with whatever the teardown stopped (its
 * runtime, and with it the computer's presence). Once it settles the app exits:
 * Electron ignores a second quit after will-quit was held, and the app would live
 * on with no window, its update never installed.
 */
export function teardownOnQuit(
  app: Pick<App, 'on' | 'exit'>,
  teardown: () => Promise<unknown>,
): void {
  let tornDown = false

  app.on('will-quit', (event) => {
    if (tornDown) return
    tornDown = true
    event.preventDefault()
    void teardown().finally(() => app.exit())
  })
}
