import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { patchDesktopAdapter } from './adapter-patches.mjs'
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

test('Codex on a Box gets the same computer-use server, from its session env', () => {
  const handoff = (fallback) =>
    `config: nuphosCodexSessionConfig(await this.createSessionConfig(request.cwd, additionalDirectories, nuphosBridgeMcpServers(request.mcpServers${fallback})), request._meta),`
  // What the runtime's codex patch leaves in the bundle: its session-home helper, inlined.
  const sessionHome = readFileSync(
    new URL('../../runtime/image/session-home.mjs', import.meta.url),
    'utf8',
  )
  const source = [
    sessionHome,
    "      args: ['/opt/nuphos-runtime/mcp-http-bridge.mjs', server.url],",
    "      env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: dir }],",
    '    await nuphosSyncRuntimeSkills(params);',
    '  async handleElicitation(params) {\n    try {',
    handoff(''),
    handoff(' ?? []'),
    handoff(''),
  ].join('\n')
  const patched = patchDesktopAdapter(source, 'codex')

  assert.equal(patched.match(/nuphosBoxDesktopMcpServers\(nuphosBridgeMcpServers/gu)?.length, 3)
  assert.match(
    patched,
    /request\.mcpServers \?\? \[\]\), request\._meta\?\.\['ai\.nuphos\/codex'\]\?\.env/u,
  )
  assert.match(patched, /function nuphosBoxDesktopMcpServers\(/u)
  // The env Codex's session carries names the session, as Claude's does.
  const servers = nuphosBoxDesktopMcpServers(bridge, { NUPHOS_SESSION_ID: 'c1' }, box)

  assert.equal(servers[1].name, 'computer-use')
  assert.throws(() => patchDesktopAdapter(source.replace(handoff(' ?? []'), ''), 'codex'))
  // Without the runtime patch's helper underneath, the desktop patch refuses to build.
  assert.throws(
    () => patchDesktopAdapter(source.replace(sessionHome, ''), 'codex'),
    /nuphosSessionHomeEnv/u,
  )
})
