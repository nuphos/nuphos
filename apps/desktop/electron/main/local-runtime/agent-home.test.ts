import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { claudeHomeSettings, prepareClaudeHome, prepareCodexHome } from './agent-home.ts'

const CUA_CACHE = path.join('plugins', 'cache', 'openai-bundled', 'unified-computer-use')
const CUA_CLIENT = path.join(
  'computer-use',
  'Codex Computer Use.app',
  'Contents',
  'SharedSupport',
  'SkyComputerUseClient.app',
  'Contents',
  'MacOS',
  'SkyComputerUseClient',
)

function codexFixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))

  t.after(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const owner = path.join(dir, 'owner')

  mkdirSync(owner)
  writeFileSync(path.join(owner, 'auth.json'), '{}')

  return { dir, owner, env: { CODEX_HOME: owner } }
}

test('Codex’s home loads the App’s Computer Use plugin, so its turn-end hook runs', (t) => {
  const f = codexFixture(t)

  mkdirSync(path.join(f.owner, CUA_CACHE, '26.930'), { recursive: true })
  writeFileSync(path.join(f.owner, 'config.toml'), '[mcp_servers.private]\n')
  const home = prepareCodexHome(f.dir, f.env)

  assert.equal(home, path.join(f.dir, 'codex-home'))
  assert.equal(readlinkSync(path.join(home, 'auth.json')), path.join(f.owner, 'auth.json'))
  assert.ok(existsSync(path.join(home, CUA_CACHE, '26.930')))
  const config = readFileSync(path.join(home, 'config.toml'), 'utf8')

  assert.match(config, /^\[plugins\."unified-computer-use@openai-bundled"\]\nenabled = true$/mu)
  assert.doesNotMatch(config, /private/u)
  // Codex edits config.toml itself; a relaunch keeps those edits and adds nothing.
  writeFileSync(
    path.join(home, 'config.toml'),
    `${config}[projects."/w"]\ntrust_level = "trusted"\n`,
  )
  prepareCodexHome(f.dir, f.env)
  const relaunched = readFileSync(path.join(home, 'config.toml'), 'utf8')

  assert.match(relaunched, /trust_level/u)
  assert.equal(relaunched.split('unified-computer-use@openai-bundled').length, 2)
})

test('Codex’s home refuses to replace a non-link login and needs the owner’s login', (t) => {
  const f = codexFixture(t)
  const home = path.join(f.dir, 'codex-home')

  mkdirSync(home)
  writeFileSync(path.join(home, 'auth.json'), '{}')
  assert.equal(prepareCodexHome(f.dir, f.env), undefined)
  rmSync(path.join(f.owner, 'auth.json'))
  rmSync(path.join(home, 'auth.json'))
  assert.equal(prepareCodexHome(f.dir, f.env), undefined)
})

test('an existing isolated home gains native macOS cleanup without importing personal commands', (t) => {
  const f = codexFixture(t)
  const home = prepareCodexHome(f.dir, f.env)!
  const config = path.join(home, 'config.toml')
  const client = path.join(f.owner, CUA_CLIENT)

  mkdirSync(path.dirname(client), { recursive: true })
  writeFileSync(client, '')
  writeFileSync(path.join(f.owner, 'config.toml'), 'notify = ["private-command"]\n')
  const original = `${readFileSync(config, 'utf8')}\n[projects."/w"]\ntrust_level = "trusted"\n`

  writeFileSync(config, original)
  prepareCodexHome(f.dir, f.env)
  const prepared = readFileSync(config, 'utf8')

  assert.equal(prepared, `notify = ${JSON.stringify([client, 'turn-ended'])}\n${original}`)
  prepareCodexHome(f.dir, f.env)
  assert.equal(readFileSync(config, 'utf8'), prepared)
})

test('native cleanup preserves an existing root notify and is absent without the App client', (t) => {
  const f = codexFixture(t)
  const home = prepareCodexHome(f.dir, f.env)!
  const config = path.join(home, 'config.toml')

  assert.doesNotMatch(readFileSync(config, 'utf8'), /notify/u)
  const client = path.join(f.owner, CUA_CLIENT)

  mkdirSync(path.dirname(client), { recursive: true })
  writeFileSync(client, '')
  const original = `notify = ["existing"]\n${readFileSync(config, 'utf8')}`

  writeFileSync(config, original)
  prepareCodexHome(f.dir, f.env)
  assert.equal(readFileSync(config, 'utf8'), original)
})

test('Claude Code’s home keeps the owner’s CLAUDE.md files above the workspace out', () => {
  const excludes = claudeHomeSettings('/Users/me/Library/Nuphos/users/u1/workspace')
    .claudeMdExcludes as string[]

  for (const file of [
    '/Users/me/.claude/CLAUDE.md',
    '/Users/me/.claude/rules/**',
    '/Users/me/CLAUDE.md',
    '/Users/me/CLAUDE.local.md',
    '/CLAUDE.md',
  ])
    assert.ok(excludes.includes(file), file)
  assert.ok(
    !excludes.some((file) => file.startsWith('/Users/me/Library/Nuphos/users/u1/workspace/')),
  )
})

test('Claude Code’s home turns off the owner’s claude.ai skills and plugins', () => {
  const settings = claudeHomeSettings('/w')

  assert.equal(settings.syncClaudeAiSkills, false)
  assert.equal(settings.syncClaudeAiPlugins, false)
})

test('the prepared home holds only Nuphos’s own settings, readable by the owner alone', (t) => {
  const userDir = mkdtempSync(path.join(os.tmpdir(), 'claude-home-'))

  t.after(() => {
    rmSync(userDir, { recursive: true, force: true })
  })
  const workspace = path.join(userDir, 'workspace')
  const home = prepareClaudeHome(userDir, workspace)

  assert.equal(home, path.join(userDir, 'claude-home'))
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')),
    claudeHomeSettings(workspace),
  )
  if (process.platform !== 'win32') assert.equal(statSync(home).mode & 0o777, 0o700)
})
