import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { patchDesktopAdapter } from './adapter-patches.mjs'
import { nuphosLocalCodexMcpServers } from './codex-cua.mjs'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'codex-cua-'))

  t.after(() => rmSync(home, { recursive: true, force: true }))
  const env = { NUPHOS_CODEX_USER_HOME: home, HOME: home }
  const executable = join(home, 'node')
  const entry = join(home, 'cua-repl.mjs')

  writeFileSync(executable, '')
  writeFileSync(entry, '')

  return {
    env,
    server: { command: executable, args: [entry], enabled: true },
    install(version, server) {
      const dir = join(home, 'plugins', 'cache', 'openai-bundled', 'unified-computer-use', version)

      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { cua_repl: server } }))
    },
  }
}

test('adds only CUA alongside conversation MCPs and preserves App runtime settings', (t) => {
  const f = fixture(t)
  const cua = {
    ...f.server,
    enabled_tools: ['js', 'js_reset', 'turn_ended'],
    startup_timeout_sec: 120,
    env: { CODEX_HOME: f.env.NUPHOS_CODEX_USER_HOME, CUA_REPL_ENABLED_SURFACES: 'computer' },
  }

  f.install('26.10', cua)
  writeFileSync(join(f.env.NUPHOS_CODEX_USER_HOME, 'config.toml'), '[mcp_servers.private]\n')
  const teamServer = { url: 'https://example.com/mcp' }
  const servers = nuphosLocalCodexMcpServers({ mcp_servers: { team: teamServer } }, f.env)

  assert.deepEqual(Object.keys(servers), ['team', 'cua_repl'])
  assert.equal(servers.team, teamServer)
  assert.deepEqual(servers.cua_repl.args, cua.args)
  assert.deepEqual(servers.cua_repl.enabled_tools, cua.enabled_tools)
  assert.equal(servers.cua_repl.env.CODEX_HOME, cua.env.CODEX_HOME)
  if (process.platform === 'darwin')
    assert.equal(
      servers.cua_repl.env.SKY_CUA_SERVICE_NATIVE_PIPE_PATH,
      join(
        f.env.HOME,
        'Library',
        'Group Containers',
        '2DC432GLL2.com.openai.sky.CUAService',
        'IPC',
        'computeruse.sock',
      ),
    )
  assert.equal(f.env.SKY_CUA_SERVICE_NATIVE_PIPE_PATH, undefined)
})

test('prefers the newest usable numeric App version and ignores incomplete upgrades', (t) => {
  const f = fixture(t)

  f.install('26.9', { ...f.server, env: { VERSION: 'old' } })
  f.install('26.10', { ...f.server, env: { VERSION: 'new' } })
  f.install('26.11', { ...f.server, command: join(f.env.HOME, 'missing') })
  assert.equal(nuphosLocalCodexMcpServers({}, f.env).cua_repl.env.VERSION, 'new')
})

test('optional CUA cannot break users without the App, disabled manifests or existing config', (t) => {
  const f = fixture(t)
  const config = { mcp_servers: { team: { command: 'node' } } }

  assert.equal(nuphosLocalCodexMcpServers(config, {}), config.mcp_servers)
  assert.equal(nuphosLocalCodexMcpServers(config, f.env), config.mcp_servers)
  f.install('26', { ...f.server, enabled: false })
  f.install('25', f.server)
  assert.equal(nuphosLocalCodexMcpServers(config, f.env), config.mcp_servers)
  f.install('26', { ...f.server, args: [42] })
  f.install('25', { ...f.server, enabled: false })
  assert.equal(nuphosLocalCodexMcpServers(config, f.env), config.mcp_servers)
  const existing = { cua_repl: { enabled: false } }

  assert.equal(nuphosLocalCodexMcpServers({ mcp_servers: existing }, f.env), existing)
})

test('keeps a configured native service socket', (t) => {
  const f = fixture(t)

  f.install('26', { ...f.server, env: { SKY_CUA_SERVICE_NATIVE_PIPE_PATH: '/custom/cua.sock' } })
  assert.equal(
    nuphosLocalCodexMcpServers({}, f.env).cua_repl.env.SKY_CUA_SERVICE_NATIVE_PIPE_PATH,
    '/custom/cua.sock',
  )
})

test('desktop bundles wire CUA into only the Codex session-config handoff', async () => {
  const base = [
    "args: ['/opt/nuphos-runtime/mcp-http-bridge.mjs', server.url],",
    "env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: dir }],",
    'await nuphosSyncRuntimeSkills(params);',
  ].join('\n')
  const codex = `${base}\nexport function nuphosCodexSessionConfig(config, meta, processEnv) {\nreturn Object.entries(config.mcp_servers ?? {}).map(([name, server]) => [name, server]);\n}`
  const patched = patchDesktopAdapter(codex)

  assert.match(patched, /Object\.entries\(nuphosLocalCodexMcpServers\(config, processEnv\)\)/u)
  assert.ok(!patchDesktopAdapter(base).includes('function nuphosLocalCodexMcpServers'))
  assert.throws(() => patchDesktopAdapter(codex.replace('config.mcp_servers ?? {}', '{}')))
  // Import the injected code too: an upstream import-name collision must fail the test.
  const importable = patched.slice(patched.indexOf('export function nuphosCodexSessionConfig'))
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(importable).toString('base64')}`
  )

  assert.deepEqual(mod.nuphosCodexSessionConfig({ mcp_servers: { team: {} } }, {}, {}), [
    ['team', {}],
  ])
})
