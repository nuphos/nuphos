import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nuphosBoxDesktopMcpServers } from './box-desktop-mcp.mjs'

// The injected function calls nuphosSessionHomeEnv from the adapter's scope.
globalThis.nuphosSessionHomeEnv = (sessionEnv) => ({
  HOME: `/homes/${sessionEnv.NUPHOS_SESSION_ID}`,
})

const bridge = [
  { name: 'nuphos-tools', command: '/node', args: ['bridge.mjs', 'https://x'], env: [] },
]
const box = {
  NUPHOS_DESKTOP_SESSION: '/bundle/desktop-session.mjs',
  NUPHOS_DESKTOP_POOL: '/agent/desktops',
  NUPHOS_DESKTOP_POOL_SIZE: '4',
  PATH: '/usr/bin',
}

test('a session on a Box gets a computer-use server on its own desktop', () => {
  const servers = nuphosBoxDesktopMcpServers(bridge, { NUPHOS_SESSION_ID: 's1' }, box)

  assert.equal(servers.length, 2)
  assert.deepEqual(servers[1], {
    name: 'computer-use',
    command: process.execPath,
    args: ['/bundle/desktop-session.mjs', 'serve'],
    env: [
      { name: 'NUPHOS_SESSION_ID', value: 's1' },
      { name: 'NUPHOS_DESKTOP_POOL', value: '/agent/desktops' },
      { name: 'NUPHOS_DESKTOP_POOL_SIZE', value: '4' },
      { name: 'HOME', value: '/homes/s1' },
      { name: 'PATH', value: '/usr/bin' },
      { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
    ],
  })
})

test('without a pool, a session id or servers, nothing changes', () => {
  assert.equal(
    nuphosBoxDesktopMcpServers(bridge, { NUPHOS_SESSION_ID: 's1' }, { PATH: '/usr/bin' }),
    bridge,
  )
  assert.equal(nuphosBoxDesktopMcpServers(bridge, {}, box), bridge)
  assert.equal(nuphosBoxDesktopMcpServers(undefined, { NUPHOS_SESSION_ID: 's1' }, box), undefined)
  const own = [{ name: 'computer-use', command: 'x', args: [] }]

  assert.equal(nuphosBoxDesktopMcpServers(own, { NUPHOS_SESSION_ID: 's1' }, box), own)
})
