import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { before, mock, test } from 'node:test'

import type {
  stopDockTabWatch as StopDockTabWatch,
  watchDockTab as WatchDockTab,
} from './dock-tabs.ts'

const ipc = new EventEmitter()
const page = { id: 7 }
/** What the renderer answered, and what it was asked to do. */
const asked: string[] = []
const window = {
  isDestroyed: () => false,
  webContents: {
    executeJavaScript: async (script: string) => {
      asked.push(script.startsWith('window.nuphosWatchDockTab') ? 'watch' : 'unwatch')

      return script.startsWith('window.nuphosWatchDockTab') ? 7 : undefined
    },
  },
}
let watchDockTab: typeof WatchDockTab
let stopDockTabWatch: typeof StopDockTabWatch

before(async () => {
  mock.module('electron', {
    namedExports: {
      BrowserWindow: { getAllWindows: () => [window] },
      ipcMain: {
        on: (channel: string, listener: (...args: unknown[]) => void) => ipc.on(channel, listener),
      },
      webContents: { fromId: (id: number) => (id === page.id ? page : undefined) },
    },
  })
  ;({ watchDockTab, stopDockTabWatch } = await import('./dock-tabs.ts'))
})

test("one phone per tab, and the Mac's Stop ends it and turns phones away for a while", async () => {
  let ended = 0
  const first = await watchDockTab('s', 'tab-1', 390, 700, () => ended++)

  assert.ok(first && 'page' in first)
  assert.deepEqual(await watchDockTab('s', 'tab-1', 390, 700, () => {}), {
    refused: 'This tab is already open on another phone.',
  })
  // The dock's Stop arrives over IPC.
  ipc.emit('dock:stopWatch', {}, 'tab-1')
  assert.equal(ended, 1)
  first.stop()
  assert.deepEqual(asked, ['watch', 'unwatch'])
  assert.deepEqual(await watchDockTab('s', 'tab-1', 390, 700, () => {}), {
    refused: 'Viewing was stopped on the Mac. Try again in a moment.',
  })
  // Another tab is not affected.
  const other = await watchDockTab('s', 'tab-2', 390, 700, () => {})

  assert.ok(other && 'page' in other)
  other.stop()
  stopDockTabWatch('nothing-open')
})
