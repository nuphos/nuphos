import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { updateAgentCli } from './agent-cli-update.ts'
import { openCodeConnected, openCodeCredentials } from './agent-cli-opencode.ts'
import { parseCodexLoginStatus, probeAgentCli } from './agent-cli.ts'
import { logoutOpenCode } from './agent-credentials.ts'

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
  'a Max 20x tier reads as Ultra, the name Anthropic gave that plan',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-plan-'))

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const node = `'${process.execPath.replaceAll("'", "'\\''")}'`

    writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\nexec ${node} -e 'console.log("2.1.0")'\n`, {
      mode: 0o700,
    })
    const home = path.join(dir, 'claude-home')
    const planOf = async (oauth: Record<string, string>) => {
      writeFileSync(
        path.join(home, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { refreshToken: 'r', ...oauth } }),
      )
      const status = await probeAgentCli('claude-code', { PATH: dir, HOME: dir }, home)

      return status.installed ? status.plan : undefined
    }

    mkdirSync(home)
    // Claude Code still stores "max" for both; only the rate limit tier tells them apart.
    assert.equal(
      await planOf({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' }),
      'ultra',
    )
    assert.equal(
      await planOf({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' }),
      'max',
    )
    assert.equal(await planOf({ subscriptionType: 'max' }), 'max')
    assert.equal(await planOf({ subscriptionType: 'pro' }), 'pro')
    assert.equal(
      await planOf({ subscriptionType: 'team', rateLimitTier: 'default_claude_max_20x' }),
      'team',
    )
  },
)

test(
  'Grok Build and DSH are signed in once their credential file is in the agent home',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-credential-'))
    const home = path.join(dir, 'home')

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    for (const command of ['grok', 'dsh'])
      writeFileSync(path.join(dir, command), '#!/bin/sh\necho 1.0.46\n', { mode: 0o700 })
    const env = { PATH: dir, HOME: dir }
    const files = {
      grok: path.join(home, '.grok', 'auth.json'),
      dsh: path.join(home, '.dsh', '.credentials.yaml'),
    }

    for (const provider of ['grok', 'dsh'] as const) {
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

test(
  'OpenCode with no provider connected is signed in, as its free models need no sign-in (#3598)',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-opencode1-'))
    const home = path.join(dir, 'home')

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    // OpenCode 1.x: no auth.json in a clean home, and `auth list` rejects the 2.x flags.
    writeFileSync(
      path.join(dir, 'opencode'),
      '#!/bin/sh\nif [ "$1" = --version ]; then echo 1.19.6; exit; fi\necho "opencode auth list" >&2\nexit 1\n',
      { mode: 0o700 },
    )

    assert.deepEqual(await probeAgentCli('opencode', { PATH: dir, HOME: dir }, home), {
      installed: true,
      path: path.join(dir, 'opencode'),
      version: '1.19.6',
      loggedIn: true,
    })
  },
)

test(
  'OpenCode 2.x is signed in with nothing connected, and a connection names the account',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cli-opencode2-'))
    const home = path.join(dir, 'home')
    const listing = path.join(dir, 'listing.json')
    const ran = path.join(dir, 'args')

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(
      path.join(dir, 'opencode'),
      `#!/bin/sh\nif [ "$1" = --version ]; then echo opencode v2.1.4; exit; fi\necho "$@" "HOME=$HOME" > '${ran}'\n/bin/cat '${listing}'\n`,
      { mode: 0o700 },
    )
    const env = { PATH: dir, HOME: dir }
    const probe = () => probeAgentCli('opencode', env, home)

    writeFileSync(listing, '[]')
    assert.deepEqual(await probe(), {
      installed: true,
      path: path.join(dir, 'opencode'),
      version: '2.1.4',
      loggedIn: true,
    })
    assert.equal(
      readFileSync(ran, 'utf8').trim(),
      `auth list --standalone --format json HOME=${home}`,
      'asked with a private server, in the agent home rather than the shell’s',
    )

    writeFileSync(
      listing,
      JSON.stringify([
        { id: 'anthropic', name: 'Anthropic', connections: [] },
        {
          id: 'opencode',
          name: 'OpenCode Console',
          connections: [{ type: 'credential', label: 'Work' }],
        },
      ]),
    )
    assert.deepEqual(await probe(), {
      installed: true,
      path: path.join(dir, 'opencode'),
      version: '2.1.4',
      loggedIn: true,
      account: 'OpenCode Console',
    })
  },
)

test(
  'a Codex CLI too old to list working models asks for an update instead of starting',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-codex-version-'))
    const file = path.join(dir, 'codex')

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const probe = (version: string) => {
      writeFileSync(
        file,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli ${version}"; else echo "Logged in using ChatGPT"; fi\n`,
        { mode: 0o700 },
      )

      return probeAgentCli('codex', { HOME: dir, PATH: dir }, path.join(dir, 'home'))
    }

    assert.deepEqual(await probe('0.120.0'), {
      installed: false,
      error:
        'Codex 0.120.0 is too old to run here. Update Codex to 0.155.0 or newer, then try again.',
    })
    assert.equal((await probe('0.155.0')).installed, true)
    assert.equal((await probe('0.171.0')).installed, true)
  },
)

test('a Codex API key login says so without the part of the key Codex prints', () => {
  assert.deepEqual(parseCodexLoginStatus('Logged in using an API key - sk-proj-***67890\n'), {
    loggedIn: true,
    apiKey: true,
  })
  // What codex-cli 0.164 prints for a key.
  assert.deepEqual(
    parseCodexLoginStatus(
      'API key configured - sk-proj-***67890\nAuthentication is checked when you send a request.\n',
    ),
    { loggedIn: true, apiKey: true },
  )
  assert.deepEqual(parseCodexLoginStatus('Logged in using ChatGPT'), {
    loggedIn: true,
    account: 'ChatGPT',
  })
})

test(
  'Antigravity status uses its CLI in the prepared home, never an OAuth file',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-agy-cli-'))
    const home = path.join(dir, 'runtime')

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const file = path.join(dir, 'agy')

    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.5.0; elif [ "$HOME" = "${
        home
      }" ]; then echo Gemini; else echo wrong-home >&2; exit 1; fi\n`,
      { mode: 0o700 },
    )
    assert.deepEqual(await probeAgentCli('antigravity', { HOME: dir, PATH: dir }, home), {
      installed: true,
      path: file,
      version: '1.5.0',
      loggedIn: true,
    })
    const unknown = await probeAgentCli('antigravity', { HOME: dir, PATH: dir }, undefined)

    assert.equal(unknown.installed && unknown.loggedIn, null)
  },
)

test('OpenCode 2.x names the credentials of each integration that auth logout takes', () => {
  assert.deepEqual(
    openCodeCredentials(
      JSON.stringify([
        { id: 'openai', connections: [{ type: 'credential', id: 'cred_a' }] },
        {
          id: 'openrouter',
          connections: [
            { type: 'credential', id: 'cred_b' },
            { type: 'env', id: 'OPENROUTER_API_KEY' },
          ],
        },
        { id: 'anthropic', connections: [] },
      ]),
    ),
    [
      { integration: 'openai', credential: 'cred_a' },
      { integration: 'openrouter', credential: 'cred_b' },
    ],
  )
  // A 1.x CLI rejects the flags; nothing it prints names a credential.
  assert.deepEqual(openCodeCredentials('error: unknown option --standalone'), [])
  assert.deepEqual(openCodeCredentials('{}'), [])
})

test('OpenCode 2.x is still connected while any integration has a connection', () => {
  const list = (connections: object[]) => JSON.stringify([{ id: 'openai', connections }])

  assert.equal(openCodeConnected(list([{ type: 'credential', id: 'cred_a' }])), true)
  assert.equal(openCodeConnected(list([{ type: 'env', id: 'OPENAI_API_KEY' }])), true)
  assert.equal(openCodeConnected(list([])), false)
  // Unread: a 1.x CLI prints its help, and a failed command prints nothing.
  assert.equal(openCodeConnected('error: unknown option --standalone'), undefined)
  assert.equal(openCodeConnected(''), undefined)
  assert.equal(openCodeConnected('{}'), undefined)
})

test(
  'OpenCode 2.x is logged out of each credential, one at a time, in its own home',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-opencode-logout-'))
    const home = path.join(dir, 'home')
    const state = path.join(dir, 'state')
    const log = path.join(dir, 'log')

    t.after(() => rmSync(dir, { recursive: true, force: true }))
    mkdirSync(home)
    writeFileSync(state, 'cred_a\ncred_b\n')
    // As OpenCode 2.3: list as JSON, log out a named credential (exit 1 once it is gone).
    writeFileSync(
      path.join(dir, 'opencode'),
      `#!/bin/sh
echo "$HOME $*" >> '${log}'
if [ "$1 $2" = "auth list" ]; then
  printf '[{"id":"openai","connections":['
  sep=''
  for c in $(cat '${state}'); do printf '%s{"type":"credential","id":"%s"}' "$sep" "$c"; sep=','; done
  printf ']}]'
  exit 0
fi
if [ "$1 $2" = "auth logout" ] && grep -qx "$4" '${state}'; then
  grep -vx "$4" '${state}' > '${state}.next'; mv '${state}.next' '${state}'; exit 0
fi
exit 1
`,
      { mode: 0o700 },
    )

    // The stub uses the system's sh tools; OpenCode itself is the one in `dir`.
    assert.equal(await logoutOpenCode({ PATH: `${dir}:/usr/bin:/bin`, HOME: dir }, home), false)

    assert.equal(readFileSync(state, 'utf8'), '')
    const calls = readFileSync(log, 'utf8').trim().split('\n')

    assert.deepEqual(
      calls.map((line) => line.split(' ').slice(1).join(' ')),
      [
        'auth list --standalone --format json',
        'auth logout openai cred_a --standalone',
        'auth logout openai cred_b --standalone',
        // Then whether any provider is still connected.
        'auth list --standalone --format json',
      ],
    )
    // In the agent's own home, never the owner's.
    assert.ok(calls.every((line) => line.startsWith(`${home} `)))
  },
)
