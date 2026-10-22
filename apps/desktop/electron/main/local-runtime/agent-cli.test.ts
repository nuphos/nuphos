import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { updateAgentCli } from './agent-cli-update.ts'
import { probeAgentCli } from './agent-cli.ts'

// Real child processes make sure the status command sees the runtime environment,
// rather than merely checking the object we intended to pass to execFile.
test(
  'Codex auth probes use the isolated home and exclude shell API credentials',
  {
    skip: process.platform === 'win32',
  },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-probe-'))

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    // A shebang cannot contain the spaces in the macOS session Node path.
    const node = `'${process.execPath.replaceAll("'", "'\\''")}'`
    const source = `#!/bin/sh
exec ${node} - "$@" <<'NUPHOS_TEST_JS'
if (process.argv.includes('--version')) console.log('2.1.0');
else {
  const e = process.env;
  if (e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY) throw new Error('shell credential leaked');
  console.log(e.CODEX_HOME === ${JSON.stringify(path.join(dir, 'isolated'))}
    ? 'Logged in using ChatGPT' : 'Not logged in');
}
NUPHOS_TEST_JS
`

    for (const command of ['claude', 'codex'])
      writeFileSync(path.join(dir, command), source, { mode: 0o700 })
    const env = {
      PATH: dir,
      HOME: dir,
      CLAUDE_CONFIG_DIR: path.join(dir, 'personal'),
      ANTHROPIC_API_KEY: 'shell-only',
      OPENAI_API_KEY: 'shell-only',
    }
    const isolated = path.join(dir, 'isolated')

    assert.deepEqual(await probeAgentCli('codex', env, isolated), {
      installed: true,
      path: path.join(dir, 'codex'),
      version: '2.1.0',
      loggedIn: true,
      account: 'ChatGPT',
    })
    const unavailable = await probeAgentCli('claude-code', env, undefined)

    assert.equal(unavailable.installed && unavailable.loggedIn, null)
  },
)

test(
  'update runs the CLI on PATH with its own update command',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-update-'))

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(
      path.join(dir, 'codex'),
      `#!/bin/sh\necho "$@" > ${JSON.stringify(path.join(dir, 'args'))}\n`,
      {
        mode: 0o700,
      },
    )
    writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    const env = { PATH: dir, HOME: dir }

    await updateAgentCli('codex', env)
    assert.equal(readFileSync(path.join(dir, 'args'), 'utf8').trim(), 'update')
    await assert.rejects(updateAgentCli('claude-code', env))
    await assert.rejects(updateAgentCli('opencode' as never, env), /Install the runtime/u)
  },
)

test(
  'a Claude login is read from its credential, never by running claude auth status',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-tokens-'))

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const node = `'${process.execPath.replaceAll("'", "'\\''")}'`

    writeFileSync(
      path.join(dir, 'claude'),
      // `claude auth status` refreshes an expired token and can lose the rotated one.
      `#!/bin/sh\ncase "$*" in *auth*) : > ${JSON.stringify(path.join(dir, 'auth-ran'))};; esac\nexec ${node} -e 'console.log("2.1.0")'\n`,
      { mode: 0o700 },
    )
    const authRan = path.join(dir, 'auth-ran')

    // The sentinel must work with PATH limited to the fake CLI.
    execFileSync(path.join(dir, 'claude'), ['auth', 'status'], { env: { PATH: dir } })
    assert.equal(existsSync(authRan), true)
    rmSync(authRan)
    const home = path.join(dir, 'claude-home')
    const credential = path.join(home, '.credentials.json')
    const env = { PATH: dir, HOME: dir }

    mkdirSync(home)
    writeFileSync(credential, JSON.stringify({ claudeAiOauth: { subscriptionType: 'team' } }))
    const gone = await probeAgentCli('claude-code', env, home)

    assert.equal(gone.installed && gone.loggedIn, false)
    writeFileSync(
      credential,
      JSON.stringify({ claudeAiOauth: { refreshToken: 'r', subscriptionType: 'team' } }),
    )
    const kept = await probeAgentCli('claude-code', env, home)

    assert.equal(kept.installed && kept.loggedIn, true)
    writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'a@example.com' } }),
    )
    assert.deepEqual(await probeAgentCli('claude-code', env, home), {
      installed: true,
      path: path.join(dir, 'claude'),
      version: '2.1.0',
      loggedIn: true,
      account: 'a@example.com',
      plan: 'team',
    })
    assert.equal(existsSync(authRan), false)
  },
)

test(
  'Grok Build and OpenCode are signed in once their credential file is in the agent home',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-credential-'))
    const home = path.join(dir, 'home')

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    for (const command of ['grok', 'opencode'])
      writeFileSync(path.join(dir, command), '#!/bin/sh\necho 1.0.46\n', { mode: 0o700 })
    const env = { PATH: dir, HOME: dir }
    const files = {
      grok: path.join(home, '.grok', 'auth.json'),
      opencode: path.join(home, '.local', 'share', 'opencode', 'auth.json'),
    }

    for (const provider of ['grok', 'opencode'] as const) {
      const loggedIn = async (agentHome: string | undefined) => {
        const cli = await probeAgentCli(provider, env, agentHome)

        return cli.installed ? cli.loggedIn : undefined
      }

      assert.deepEqual(await probeAgentCli(provider, env, home), {
        installed: true,
        path: path.join(dir, provider),
        version: '1.0.46',
        loggedIn: false,
      })
      mkdirSync(path.dirname(files[provider]), { recursive: true })
      writeFileSync(files[provider], '{}')
      assert.equal(await loggedIn(home), false, 'an empty login is not a sign-in')
      writeFileSync(files[provider], '{"xai":{"type":"oauth"}}')
      assert.equal(await loggedIn(home), true)
      assert.equal(await loggedIn(undefined), null)
    }
  },
)
