/** The parts of a page's global object this touches (the Electron tsconfig has no DOM types). */
export type ChromePage = {
  chrome?: Record<string, unknown>
  performance: {
    now(): number
    timing: Record<
      'navigationStart' | 'responseStart' | 'domContentLoadedEventEnd' | 'loadEventEnd',
      number
    >
  }
}

/**
 * Gives `window.chrome` the `loadTimes`, `csi` and `app` members every Chrome page has. Electron
 * leaves `window.chrome` empty, and Google sign-in rejects a browser without them ("This browser
 * or app may not be secure") whatever its user agent says.
 *
 * Runs in the page's main world through `contextBridge.executeInMainWorld`, which serializes the
 * function, so it must not reference anything outside its own body.
 */
export function addChromeObject(page = globalThis as unknown as ChromePage) {
  page.chrome ??= {}
  const chrome = page.chrome

  if ('loadTimes' in chrome) return
  const timing = page.performance.timing
  // Helpers stay inside: executeInMainWorld sends only this function's own source.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const seconds = (ms: number) => ms / 1000
  const define = (name: string, value: unknown) =>
    Object.defineProperty(chrome, name, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    })

  define('loadTimes', function loadTimes() {
    return {
      requestTime: seconds(timing.navigationStart),
      startLoadTime: seconds(timing.navigationStart),
      commitLoadTime: seconds(timing.responseStart),
      finishDocumentLoadTime: seconds(timing.domContentLoadedEventEnd),
      finishLoadTime: seconds(timing.loadEventEnd),
      firstPaintTime: seconds(timing.domContentLoadedEventEnd),
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2',
    }
  })
  define('csi', function csi() {
    return {
      startE: timing.navigationStart,
      onloadT: timing.loadEventEnd,
      pageT: page.performance.now(),
      tran: 15,
    }
  })
  define('app', {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: function getDetails() {
      return null
    },
    getIsInstalled: function getIsInstalled() {
      return false
    },
    installState: function installState(callback?: (state: string) => void) {
      callback?.('not_installed')
    },
    runningState: function runningState() {
      return 'cannot_run'
    },
  })
}
