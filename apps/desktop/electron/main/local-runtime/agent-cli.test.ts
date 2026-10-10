import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { updateAgentCli } from './agent-cli-update.ts'
import { probeAgentCli } from './agent-cli.ts'

// Real child processes make sure the status command sees the runtime environment,
// rather than merely checking the object we intended to pass to execFile.
test(
  'auth probes use the isolated home and exclude shell API credentials',
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
  if (process.argv.includes('auth')) console.log(JSON.stringify({
    loggedIn: e.CLAUDE_CONFIG_DIR === ${JSON.stringify(path.join(dir, 'isolated'))}
      && e.HOME === ${JSON.stringify(dir)},
    email: e.CLAUDE_SECURESTORAGE_CONFIG_DIR,
  }));
  else console.log(e.CODEX_HOME === ${JSON.stringify(path.join(dir, 'isolated'))}
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
    const claude = await probeAgentCli('claude-code', env, isolated)

    assert.deepEqual(claude, {
      installed: true,
      path: path.join(dir, 'claude'),
      version: '2.1.0',
      loggedIn: true,
      account: process.platform === 'darwin' ? env.CLAUDE_CONFIG_DIR : isolated,
    })
    assert.deepEqual(await probeAgentCli('codex', env, isolated), {
      installed: true,
      path: path.join(dir, 'codex'),
      version: '2.1.0',
      loggedIn: true,
      account: 'ChatGPT',
    })
    const override = await probeAgentCli(
      'claude-code',
      {
        ...env,
        CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
      },
      isolated,
    )

    assert.equal(
      override.installed && override.account,
      process.platform === 'darwin' ? '' : isolated,
    )
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
    await assert.rejects(updateAgentCli('opencode' as never, env), /Install the agent/u)
  },
)
