import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

// The package's preload, as patched in patches/electron-chrome-extensions@*.patch.
const preload = readFileSync(
  createRequire(import.meta.url).resolve('electron-chrome-extensions/preload'),
  'utf8',
)
const noop = () => null

test('extensions that use `browser` get the same APIs as `chrome`', () => {
  const ipcRenderer = { send: noop, on: noop, addListener: noop, removeListener: noop }
  const worker = {
    // Chromium's own `browser` lacks most APIs, as in a real service worker.
    browser: {},
    chrome: {
      runtime: { id: 'a'.repeat(32), getManifest: () => ({ manifest_version: 3 }) },
      i18n: { getMessage: noop },
    },
    location: { href: `chrome-extension://${'a'.repeat(32)}/background.js` },
    process: { type: 'service-worker', contextIsolated: false },
    require: (name: string) => {
      assert.equal(name, 'electron')

      return { ipcRenderer, contextBridge: {}, webFrame: {} }
    },
    console: { log: noop, warn: noop, error: noop },
  }

  // eslint-disable-next-line sonarjs/code-eval -- runs the package's own preload file
  vm.runInNewContext(preload, worker)

  assert.equal(worker.browser, worker.chrome)
  assert.equal(
    (worker.browser as { windows?: { WINDOW_ID_NONE: number } }).windows?.WINDOW_ID_NONE,
    -1,
  )
})
