import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  claudeHomeSettings,
  hardLinkFrom,
  podOwnerAgentHome,
  prepareAgentHome,
  prepareClaudeHome,
  prepareCodexHome,
} from './agent-home.ts'

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

test('Codex’s home keeps its own login and runs signed out without the owner’s', (t) => {
  const f = codexFixture(t)
  const home = path.join(f.dir, 'codex-home')

  mkdirSync(home)
  writeFileSync(path.join(home, 'auth.json'), '{}')
  assert.equal(prepareCodexHome(f.dir, f.env), home)
  assert.equal(readFileSync(path.join(home, 'auth.json'), 'utf8'), '{}')
  rmSync(path.join(f.owner, 'auth.json'))
  rmSync(path.join(home, 'auth.json'))
  assert.equal(prepareCodexHome(f.dir, f.env), home)
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

  const notify = ['/usr/bin/env', `CODEX_HOME=${f.owner}`, client, 'turn-ended']

  assert.equal(prepared, `notify = ${JSON.stringify(notify)}\n${original}`)
  // Migrate the earlier generated command; it inherited the isolated home.
  writeFileSync(config, `notify = ${JSON.stringify([client, 'turn-ended'])}\n${original}`)
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

test('the runtime links the same custom CODEX_HOME used by local login', (t) => {
  const f = codexFixture(t)
  const home = prepareAgentHome('codex', f.dir, path.join(f.dir, 'workspace'), f.env)

  assert.ok(home)
  assert.equal(readlinkSync(path.join(home, 'auth.json')), path.join(f.owner, 'auth.json'))
})

test('changing CODEX_HOME relinks only isolated symlinks, without copying credentials', (t) => {
  const f = codexFixture(t)
  const home = prepareCodexHome(f.dir, f.env)
  const nextOwner = path.join(f.dir, 'next-owner')

  mkdirSync(nextOwner)
  writeFileSync(path.join(nextOwner, 'auth.json'), '{"new":true}')
  assert.equal(prepareCodexHome(f.dir, { CODEX_HOME: nextOwner }), home)
  assert.ok(home)
  assert.equal(readlinkSync(path.join(home, 'auth.json')), path.join(nextOwner, 'auth.json'))
  assert.equal(readFileSync(path.join(f.owner, 'auth.json'), 'utf8'), '{}')
})

test('on Windows the login is a hard link that follows the owner’s login', (t) => {
  const f = codexFixture(t)
  const home = path.join(f.dir, 'codex-home')
  const link = path.join(home, 'auth.json')

  mkdirSync(home)
  // What earlier Windows builds left behind: a link Codex cannot read.
  symlinkSync(path.join(f.owner, 'auth.json'), link)
  hardLinkFrom(f.owner, home, 'auth.json')
  assert.equal(statSync(link).ino, statSync(path.join(f.owner, 'auth.json')).ino)

  // Codex rewrites the file in place, so a refreshed token reaches both homes.
  writeFileSync(link, '{"tokens":1}')
  assert.equal(readFileSync(path.join(f.owner, 'auth.json'), 'utf8'), '{"tokens":1}')

  // The owner signed in again: the stale hard link follows the new file.
  rmSync(path.join(f.owner, 'auth.json'))
  writeFileSync(path.join(f.owner, 'auth.json'), '{"tokens":2}')
  hardLinkFrom(f.owner, home, 'auth.json')
  assert.equal(readFileSync(link, 'utf8'), '{"tokens":2}')

  // A login made here stays while the owner has none.
  rmSync(path.join(f.owner, 'auth.json'))
  rmSync(link)
  writeFileSync(link, '{"own":true}')
  hardLinkFrom(f.owner, home, 'auth.json')
  assert.equal(readFileSync(link, 'utf8'), '{"own":true}')
})

test('on Windows a login that cannot be linked leaves the current one in place', (t) => {
  const f = codexFixture(t)
  const home = path.join(f.dir, 'codex-home')
  const link = path.join(home, 'auth.json')

  mkdirSync(home)
  writeFileSync(link, '{"own":true}')
  // A directory cannot be hard-linked, so linkSync fails as it does across volumes.
  rmSync(path.join(f.owner, 'auth.json'))
  mkdirSync(path.join(f.owner, 'auth.json'))
  hardLinkFrom(f.owner, home, 'auth.json')
  assert.equal(readFileSync(link, 'utf8'), '{"own":true}')
  assert.deepEqual(readdirSync(home), ['auth.json'])
})

test('on Windows without the owner’s login nothing is linked', (t) => {
  const f = codexFixture(t)
  const home = path.join(f.dir, 'codex-home')

  rmSync(path.join(f.owner, 'auth.json'))
  mkdirSync(home)
  hardLinkFrom(f.owner, home, 'auth.json')
  assert.equal(existsSync(path.join(home, 'auth.json')), false)
})

test('a hosted pod’s owner uses the pod’s own Claude login; other members keep theirs', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-pod-owner-'))

  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const data = path.join(dir, 'agent')
  const home = path.join(dir, 'home')
  const prepare = podOwnerAgentHome('owner-1', data, home)
  const member = (id: string) => path.join(data, 'users', id)

  assert.equal(
    prepare('claude-code', member('owner-1'), path.join(member('owner-1'), 'workspace'), {}),
    path.join(home, '.claude'),
  )
  // Another member on a team-wide pod never reads the owner's login.
  assert.equal(
    prepare('claude-code', member('member-2'), path.join(member('member-2'), 'workspace'), {}),
    path.join(member('member-2'), 'claude-home'),
  )
  // Without a named owner, as on a Box or a person's computer, nothing changes.
  assert.equal(
    podOwnerAgentHome(undefined, data, home)(
      'claude-code',
      member('owner-1'),
      path.join(member('owner-1'), 'workspace'),
      {},
    ),
    path.join(member('owner-1'), 'claude-home'),
  )
})
