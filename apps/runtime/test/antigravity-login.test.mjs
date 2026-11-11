import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { authorizePrompt, runAntigravityLogin } from '../image/antigravity-login.mjs'
import { antigravityStatus } from '../image/antigravity-status.mjs'

const AUTHORIZE =
  'https://accounts.google.com/o/oauth2/auth?redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&state=test'
const CLI = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === 'models') {
  if (process.env.TEST_STATUS === 'signed-out') {
    console.error('Error: Please sign in to view available models. Launch the CLI without arguments to sign in.')
    process.exit(1)
  }
  if (process.env.TEST_STATUS === 'unavailable') { console.error('Network unavailable'); process.exit(1) }
  console.log('Gemini')
  process.exit(0)
}
if (JSON.stringify(args) !== JSON.stringify(['acp', '--login'])) process.exit(2)
if (process.env.NUPHOS_TOKEN) process.exit(3)
process.stderr.write('Open this link in a browser to log in with Google:\\n\\n  ${AUTHORIZE}\\n\\nThen paste the authorization code:\\n')
require('node:readline').createInterface({ input: process.stdin }).on('line', (code) => {
  if (code === 'denied') { console.error('secret-provider-output'); process.exit(1) }
  fs.writeFileSync(process.env.HOME + '/cli-owned-login', code)
  process.exit(0)
})
`

async function withCli(fn) {
  const home = await mkdtemp(join(tmpdir(), 'antigravity-login-test-'))
  const executable = join(home, 'agy')
  try {
    await writeFile(executable, CLI)
    await chmod(executable, 0o755)
    await fn({ home, executable })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('official authorize URLs only; the new terminal callback needs no loopback forwarding', () => {
  assert.equal(authorizePrompt(`Open: ${AUTHORIZE}\n`), AUTHORIZE)
  assert.equal(authorizePrompt('https://accounts.google.com/elsewhere'), null)
  assert.equal(authorizePrompt('https://accounts.google.com.evil/o/oauth2/auth'), null)
  assert.equal(authorizePrompt('https://attacker@accounts.google.com/o/oauth2/auth'), null)
})

test('the official CLI receives the code and owns the sign-in; no credential leaves it', async () => {
  await withCli(async ({ home, executable }) => {
    const input = new PassThrough()
    const frames = []
    await runAntigravityLogin({
      executable,
      env: {
        HOME: '/not-the-agent-home',
        NUPHOS_AGENT_HOME: home,
        PATH: process.env.PATH,
        NUPHOS_TOKEN: 'must-not-reach-cli',
      },
      input,
      emit: (frame) => {
        frames.push(frame)
        if (frame.type === 'authorize') input.write('4/test-code\n')
      },
    })
    assert.deepEqual(frames, [{ type: 'authorize', url: AUTHORIZE }, { type: 'authenticated' }])
    assert.equal(await readFile(join(home, 'cli-owned-login'), 'utf8'), '4/test-code')
  })
})

test('denied and cancelled sign-ins never report authenticated', async () => {
  await withCli(async ({ home, executable }) => {
    for (const cancel of [false, true]) {
      const input = new PassThrough()
      const controller = new AbortController()
      const frames = []
      await assert.rejects(
        runAntigravityLogin({
          executable,
          env: { HOME: home, PATH: process.env.PATH },
          input,
          signal: controller.signal,
          emit: (frame) => {
            frames.push(frame)
            if (cancel) controller.abort()
            else input.write('denied\n')
          },
        }),
        /did not complete/,
      )
      assert.deepEqual(
        frames.map((frame) => frame.type),
        ['authorize'],
      )
    }
  })
})

test('status uses the CLI model list: signed in, signed out, or unknown on failure', async () => {
  await withCli(async ({ home, executable }) => {
    for (const [status, expected] of [
      ['signed-in', true],
      ['signed-out', false],
      ['unavailable', null],
    ]) {
      assert.equal(
        await antigravityStatus(executable, {
          HOME: home,
          PATH: process.env.PATH,
          TEST_STATUS: status,
        }),
        expected,
      )
    }
    assert.equal(await antigravityStatus(join(home, 'missing'), { HOME: home }), null)
  })
})
