import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

const install = mock.fn(async () => true)
let channels: typeof import('./channels.ts').browserExtensionChannels

before(async () => {
  mock.module('electron', { namedExports: { nativeImage: {}, webContents: {} } })
  mock.module('./store.ts', {
    namedExports: {
      isExtensionId: (id: unknown) => typeof id === 'string' && /^[a-p]{32}$/.test(id),
    },
  })
  mock.module('./host.ts', { namedExports: { extensionHost: () => null } })
  mock.module('./log.ts', { namedExports: { logError: () => null } })
  mock.module('./manage.ts', {
    namedExports: {
      browserSession: () => ({}),
      failed: new Map(),
      install,
      pinned: new Set(),
      remove: async () => true,
      setPinned: async () => {},
    },
  })
  ;({ browserExtensionChannels: channels } = await import('./channels.ts'))
})

test('without a running extension host nothing can be installed', () => {
  assert.throws(
    () => channels['browser-extensions:add']({} as never, 'nngceckbapebfimnlniiiahkandclblb'),
    /unavailable/,
  )
  assert.equal(install.mock.callCount(), 0)
})
