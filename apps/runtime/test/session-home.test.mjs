import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, dirname, relative } from 'node:path'
import test from 'node:test'

import { nuphosSessionHomeEnv, nuphosClaudeSessionEnv } from '../image/session-home.mjs'
import { nuphosCodexSessionConfig } from '../image/codex-acp/session-config.mjs'
import { agentEnv } from '../image/acp-shim.mjs'

function runtime(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-session-home-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { HOME: dir, PATH: process.env.PATH }
}

function put(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, { mode: 0o600 })
}

test('concurrent sessions keep HOME state separate, resume it, and never copy the runtime home', (t) => {
  const host = runtime(t)
  put(join(host.HOME, '.aws', 'credentials'), 'host-credentials')
  const originalEnv = { ...host }
  const a = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'a' }, host)
  const b = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'b' }, host)
  assert.notEqual(a.HOME, b.HOME)
  assert.deepEqual(host, originalEnv)
  assert.equal(statSync(a.HOME).mode & 0o777, 0o700)
  assert.throws(() => readFileSync(a.AWS_SHARED_CREDENTIALS_FILE), { code: 'ENOENT' })
  // These are the paths used by existing credential skills and ordinary CLI logins.
  for (const key of [
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CONFIG_FILE',
    'KUBECONFIG',
    'GIT_CONFIG_GLOBAL',
  ]) {
    put(b[key], 'session-b')
    put(a[key], 'session-a')
    assert.equal(readFileSync(b[key], 'utf8'), 'session-b')
  }
  for (const key of [
    'GOCACHE',
    'GOMODCACHE',
    'BUN_INSTALL_CACHE_DIR',
    'PLAYWRIGHT_BROWSERS_PATH',
    'PIP_CACHE_DIR',
    'UV_CACHE_DIR',
  ]) {
    assert.equal(a[key], b[key])
    assert.equal(relative(host.HOME, a[key]).startsWith('.nuphos'), false)
  }
  // Tools keep login state under XDG_CACHE_HOME (e.g. Hugging Face tokens).
  assert.notEqual(a.XDG_CACHE_HOME, b.XDG_CACHE_HOME)
  const resumed = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'b', NUPHOS_TOKEN: 'refreshed' }, host)
  assert.deepEqual(resumed, b)
  assert.equal(readFileSync(resumed.AWS_SHARED_CREDENTIALS_FILE, 'utf8'), 'session-b')
  assert.equal(readFileSync(join(host.HOME, '.aws', 'credentials'), 'utf8'), 'host-credentials')
  const traversal = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: '../../outside' }, host)
  assert.match(
    relative(join(host.HOME, '.nuphos', 'session-homes'), traversal.HOME),
    /^[a-f0-9]{64}$/,
  )
  assert.throws(() => nuphosSessionHomeEnv({ NUPHOS_TOKEN: 'scoped' }, host), /SESSION_ID/)
})

test('on macOS a session finds the account login Keychain, as it would without a session home', (t) => {
  if (process.platform !== 'darwin') return t.skip('Only macOS finds the Keychain through HOME')
  const keychain = (HOME) =>
    spawnSync('security', ['default-keychain'], { env: { ...process.env, HOME }, encoding: 'utf8' })
  const account = keychain(userInfo().homedir)
  if (account.status !== 0) return t.skip('This account has no default Keychain')
  const host = runtime(t)
  // A bare HOME has none: Chrome then shows "Keychain Not Found" and waits for a click.
  assert.notEqual(keychain(host.HOME).status, 0)
  const a = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'a' }, host)
  assert.equal(keychain(a.HOME).stdout, account.stdout)
  assert.deepEqual(nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'a' }, host), a)
})

test('Claude and Codex receive the same isolated paths without moving the agent login store', (t) => {
  const host = { ...runtime(t), CLAUDE_CONFIG_DIR: '/runtime/claude-login' }
  const context = {
    NUPHOS_SESSION_ID: 'conversation',
    NUPHOS_TOKEN: 'session-token',
    HOME: '/override',
  }
  const claude = nuphosClaudeSessionEnv({ ...host, ...context }, context, host)
  const codex = nuphosCodexSessionConfig({}, { 'ai.nuphos/codex': { env: context } }, host)
  assert.equal(claude.HOME, codex.shell_environment_policy.set.HOME)
  assert.equal(claude.CLAUDE_CONFIG_DIR, host.CLAUDE_CONFIG_DIR)
  assert.notEqual(claude.HOME, context.HOME)
  assert.equal(claude.NUPHOS_TOKEN, 'session-token')
  assert.equal(
    nuphosClaudeSessionEnv({}, context, { HOME: host.HOME }).CLAUDE_CONFIG_DIR,
    join(host.HOME, '.claude'),
  )
})

test('a teammate acting in a conversation gets their own HOME, the owner keeps theirs', (t) => {
  const host = runtime(t)
  const owner = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'c' }, host)
  const guest = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'c', NUPHOS_SESSION_ACTOR: 'g' }, host)
  const other = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'c', NUPHOS_SESSION_ACTOR: 'h' }, host)
  put(owner.KUBECONFIG, 'owner')
  assert.notEqual(owner.HOME, guest.HOME)
  // Named under the conversation, so reclaiming it finds every teammate's home.
  assert.match(guest.HOME, new RegExp(`^${owner.HOME}\\.[0-9a-f]{64}$`))
  assert.notEqual(guest.HOME, other.HOME)
  assert.throws(() => readFileSync(guest.KUBECONFIG), { code: 'ENOENT' })
  assert.deepEqual(
    nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'c', NUPHOS_SESSION_ACTOR: 'g' }, host),
    guest,
  )
  // Both adapters forward the actor, so Claude and Codex land in the same guest home.
  const context = { NUPHOS_SESSION_ID: 'c', NUPHOS_SESSION_ACTOR: 'g', NUPHOS_TOKEN: 't' }
  const claude = nuphosClaudeSessionEnv({ ...host, ...context }, context, host)
  const codex = nuphosCodexSessionConfig({}, { 'ai.nuphos/codex': { env: context } }, host)
  assert.equal(claude.HOME, guest.HOME)
  assert.equal(codex.shell_environment_policy.set.HOME, guest.HOME)
  assert.equal(agentEnv('grok', { env: context }, host).HOME, guest.HOME)
})

test('real git global config changes stay in the calling session', (t) => {
  const host = runtime(t)
  const a = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'a' }, host)
  const b = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'b' }, host)
  const git = (env, ...args) =>
    execFileSync('git', ['config', '--global', ...args], { env, encoding: 'utf8' }).trim()
  git(b, 'user.name', 'Session B')
  git(a, 'user.name', 'Session A')
  assert.equal(git(b, 'user.name'), 'Session B')
  assert.equal(git(a, 'user.name'), 'Session A')
  assert.throws(() => readFileSync(join(host.HOME, '.gitconfig')), { code: 'ENOENT' })
})

test('real gcloud active configuration and gh token reads remain session scoped', (t) => {
  const available = ['gcloud', 'gh'].every(
    (cli) => spawnSync(cli, ['--version'], { stdio: 'ignore' }).status === 0,
  )
  if (!available)
    return t.skip('Optional real CLI check requires gcloud and gh; no cloud requests are made')
  const host = runtime(t)
  const a = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'a' }, host)
  const b = nuphosSessionHomeEnv({ NUPHOS_SESSION_ID: 'b' }, host)
  const gcloud = (env, ...args) =>
    execFileSync('gcloud', ['config', ...args, '--quiet'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  // B sets its account first; A switches afterwards, exactly the reported failure.
  for (const [env, account] of [
    [b, 'b'],
    [a, 'a'],
  ]) {
    gcloud(env, 'configurations', 'create', `session-${account}`)
    gcloud(env, 'set', 'core/account', `${account}@example.invalid`)
    put(
      join(env.GH_CONFIG_DIR, 'hosts.yml'),
      `isolation.example.invalid:\n    oauth_token: synthetic-${account}\n    user: same-bot\n    git_protocol: https\n`,
    )
  }
  for (const [env, account] of [
    [b, 'b'],
    [a, 'a'],
  ]) {
    assert.equal(gcloud(env, 'get-value', 'core/account'), `${account}@example.invalid`)
    const token = execFileSync('gh', ['auth', 'token', '--hostname', 'isolation.example.invalid'], {
      env,
      encoding: 'utf8',
    }).trim()
    assert.equal(token, `synthetic-${account}`)
  }
})

test('sessions get the long-lived token until it lapses, and an explicit one wins', (t) => {
  const host = runtime(t)
  const configDir = join(host.HOME, '.claude')
  const context = { NUPHOS_SESSION_ID: 'long-lived' }
  const now = Date.parse('2026-10-29T00:00:00Z')
  put(
    join(configDir, '.nuphos-oauth-token.json'),
    JSON.stringify({ token: 'sk-ant-oat01-fixture', expiresAt: '2027-10-29T00:00:00Z' }),
  )

  assert.equal(
    nuphosClaudeSessionEnv({}, context, host, now).CLAUDE_CODE_OAUTH_TOKEN,
    'sk-ant-oat01-fixture',
  )
  // Lapsed: the session falls back to whatever ordinary login the runtime still has.
  assert.equal(
    nuphosClaudeSessionEnv({}, context, host, Date.parse('2027-10-30T00:00:00Z'))
      .CLAUDE_CODE_OAUTH_TOKEN,
    undefined,
  )
  assert.equal(
    nuphosClaudeSessionEnv({}, context, { ...host, CLAUDE_CODE_OAUTH_TOKEN: 'set-on-purpose' }, now)
      .CLAUDE_CODE_OAUTH_TOKEN,
    undefined,
  )
  // A spawn with no Nuphos session (the model probe) gets the token too.
  assert.equal(
    nuphosClaudeSessionEnv({ PATH: 'x' }, {}, host, now).CLAUDE_CODE_OAUTH_TOKEN,
    'sk-ant-oat01-fixture',
  )
  assert.equal(nuphosClaudeSessionEnv({ PATH: 'x' }, {}, host, now).PATH, 'x')
  // An ordinary login alone adds nothing to the environment.
  rmSync(join(configDir, '.nuphos-oauth-token.json'))
  assert.equal(nuphosClaudeSessionEnv({}, context, host, now).CLAUDE_CODE_OAUTH_TOKEN, undefined)
})
