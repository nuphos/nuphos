import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { cursorAuthFile, loginPage, runCursorLogin } from '../image/cursor-login.mjs'

const PAGE =
  'https://cursor.com/loginDeepControl?challenge=abc&uuid=1234&mode=login&redirectTarget=cli'

// `cursor-agent login` as it prints and stores its login: the page, then auth.json once approved.
async function fakeCli(dir, { approve = true } = {}) {
  const cli = join(dir, 'cursor-agent')
  await writeFile(
    cli,
    `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')
const seen = JSON.stringify({ argv: process.argv.slice(2), store: process.env.AGENT_CLI_CREDENTIAL_STORE,
  browser: process.env.NO_OPEN_BROWSER, home: process.env.HOME, token: process.env.NUPHOS_TOKEN })
writeFileSync(join(${JSON.stringify(dir)}, 'seen.json'), seen)
process.stdout.write('Waiting for browser authentication...\\n\\x1b[1mOpen a browser and navigate to this link: ${PAGE}\\x1b[0m\\n')
setTimeout(() => {
  if (!${approve}) process.exit(1)
  const file = process.platform === 'darwin'
    ? join(process.env.HOME, '.cursor', 'auth.json')
    : join(process.env.HOME, '.config', 'cursor', 'auth.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '{"accessToken":"secret"}')
  process.stdout.write('Logged in\\n')
}, 50)
`,
  )
  await chmod(cli, 0o755)
  return cli
}

test('the login file sits where the Cursor CLI keeps it on each platform', () => {
  assert.equal(cursorAuthFile('/h', 'darwin'), '/h/.cursor/auth.json')
  assert.equal(cursorAuthFile('/h', 'linux'), '/h/.config/cursor/auth.json')
})

test('the sign-in page is read from colored CLI output', () => {
  assert.deepEqual(loginPage(`\x1b[1mnavigate to this link: ${PAGE}\x1b[0m\n`), {
    type: 'browser',
    url: PAGE,
  })
  assert.equal(loginPage('Waiting for browser authentication...'), null)
})

test('a sign-in shows the page, then reports signed in once auth.json is written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nuphos-cursor-login-'))
  const prior = process.env.NUPHOS_TOKEN
  process.env.NUPHOS_TOKEN = 'conversation-token'
  try {
    const frames = []
    await runCursorLogin({ executable: await fakeCli(dir), home: dir, emit: (f) => frames.push(f) })
    assert.deepEqual(frames, [{ type: 'browser', url: PAGE }, { type: 'authenticated' }])
    const seen = JSON.parse(await readFile(join(dir, 'seen.json'), 'utf8'))
    assert.deepEqual(seen.argv, ['login'])
    // The file store, in the agent's home, with no browser opened on the host itself.
    assert.equal(seen.store, 'file')
    assert.equal(seen.browser, '1')
    assert.equal(seen.home, dir)
    // Nothing of the gateway's environment reaches the CLI.
    assert.equal(seen.token, undefined)
    // No frame carries the credential.
    assert.doesNotMatch(JSON.stringify(frames), /secret/u)
  } finally {
    if (prior === undefined) delete process.env.NUPHOS_TOKEN
    else process.env.NUPHOS_TOKEN = prior
    await rm(dir, { recursive: true, force: true })
  }
})

test('a sign-in the CLI gives up on fails, without reporting signed in', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nuphos-cursor-login-'))
  try {
    const frames = []
    await assert.rejects(
      runCursorLogin({
        executable: await fakeCli(dir, { approve: false }),
        home: dir,
        emit: (f) => frames.push(f),
      }),
      /did not complete/u,
    )
    assert.deepEqual(frames, [{ type: 'browser', url: PAGE }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a stopped sign-in ends the CLI and fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nuphos-cursor-login-'))
  const cli = join(dir, 'cursor-agent')
  await writeFile(
    cli,
    `#!/usr/bin/env node\nprocess.stdout.write('${PAGE}\\n'); setInterval(() => {}, 1000)\n`,
  )
  await chmod(cli, 0o755)
  const controller = new AbortController()
  try {
    const login = runCursorLogin({
      executable: cli,
      home: dir,
      emit: () => controller.abort(),
      signal: controller.signal,
    })
    await assert.rejects(login, /did not complete/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
