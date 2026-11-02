import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import {
  LONG_LIVED_TOKEN_FILE,
  inTerminal,
  longLivedToken,
  revokeLongLivedToken,
  runClaudeLogin,
} from '../image/claude-login.mjs'

// Same guard as claude-login.test.mjs: never spawn a sign-in on a managed runtime.
const onManagedRuntime =
  process.env.HOME?.startsWith('/home/node') === true &&
  Object.keys(process.env).some((name) => name.startsWith('NUPHOS_RUNTIME'))
const spawnsCli = { skip: onManagedRuntime && 'never spawns a sign-in on a managed runtime' }

const TOKEN = `sk-ant-oat01-${'a1B2_c3-'.repeat(12)}`
const URL_LINE =
  "Browser didn't open? Use the url below to sign in (c to copy)\nhttps://claude.com/cai/oauth/authorize?code=true&client_id=c&state=s\n"

// What `claude setup-token` does in a terminal: print the manual URL, take `code#state`
// ending in a carriage return, print the token once. `auth status` reports signed in
// only for the token it was given in the environment, and records what it saw.
const FAKE_CLI = `
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const record = process.argv[2];
const accepted = readFileSync(record + '.accepted', 'utf8');
const printed = readFileSync(record + '.printed', 'utf8');
if (process.argv.slice(-3).join(' ') === 'auth status --json') {
  const loggedIn = Boolean(accepted) && process.env.CLAUDE_CODE_OAUTH_TOKEN === accepted;
  appendFileSync(record, JSON.stringify({ status: loggedIn }) + '\\n');
  process.stdout.write(JSON.stringify({ loggedIn }));
  process.exit(loggedIn ? 0 : 1);
}
if (process.argv.at(-1) !== 'setup-token') process.exit(2);
process.stdout.write('\\x1b[2mOpening browser\\x1b[0m\\n' + ${JSON.stringify(URL_LINE)});
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  if (!buffer.endsWith('\\r')) return;
  if (buffer !== 'good-code#state\\r') process.exit(4);
  process.stdout.write('Your OAuth token (valid for 1y):\\n\\x1b[33m' + printed + '\\x1b[39m\\nStore this token securely.\\n');
  process.exit(0);
});
`

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'claude-long-lived-test-'))
  const script = join(home, 'cli.mjs')

  await writeFile(script, FAKE_CLI)

  return { home, script, record: join(home, 'record.ndjson'), configDir: join(home, '.claude') }
}

async function signIn({ home, script, record, configDir }, accepted, options = {}) {
  const { printed = TOKEN, ...rest } = options

  await writeFile(`${record}.accepted`, accepted)
  await writeFile(`${record}.printed`, printed)
  const input = new PassThrough()
  const frames = []

  // The fake needs no terminal; the real wrapper is checked on its own below.
  const run = runClaudeLogin({
    executable: process.execPath,
    args: [script, record],
    home,
    configDir,
    input,
    longLived: true,
    terminal: (command, args) => ({ command, args }),
    revoke: async () => true,
    ...rest,
    emit: (frame) => {
      frames.push(frame)
      if (frame.type === 'authorize') input.write('good-code#state\n')
    },
  })

  await run

  return frames
}

test('reads the token setup-token prints and nothing else', () => {
  assert.equal(longLivedToken(`valid for 1y):\n\x1b[33m${TOKEN}\x1b[39m\nStore`), TOKEN)
  assert.equal(longLivedToken('sk-ant-oat01-short'), null)
  assert.equal(longLivedToken(URL_LINE), null)
})

test('the terminal wrapper quotes every argument for the shell', () => {
  const { command, args } = inTerminal('/usr/bin/claude', ["it's", 'setup-token'])

  assert.equal(command, 'script')
  assert.equal(args.at(-1), '/dev/null')
  assert.match(
    args[1],
    /^stty cols 1000 rows 50; exec '\/usr\/bin\/claude' 'it'\\''s' 'setup-token'$/,
  )
})

test(
  'a long-lived sign-in stores the token owner-only and never relays it',
  spawnsCli,
  async () => {
    const fx = await fixture()

    try {
      const frames = await signIn(fx, TOKEN)
      const file = join(fx.configDir, LONG_LIVED_TOKEN_FILE)
      const stored = JSON.parse(await readFile(file, 'utf8'))

      assert.deepEqual(
        frames.map((frame) => frame.type),
        ['authorize', 'authenticated'],
      )
      assert.ok(!JSON.stringify(frames).includes(TOKEN))
      assert.equal(stored.token, TOKEN)
      assert.equal((await stat(file)).mode & 0o777, 0o600)
      const days = (Date.parse(stored.expiresAt) - Date.parse(stored.createdAt)) / 86_400_000

      assert.equal(days, 365)
    } finally {
      await rm(fx.home, { recursive: true, force: true })
    }
  },
)

test('a token the CLI rejects is never stored', spawnsCli, async () => {
  const fx = await fixture()

  try {
    await assert.rejects(signIn(fx, 'some-other-token'), { reason: 'failed' })
    await assert.rejects(readFile(join(fx.configDir, LONG_LIVED_TOKEN_FILE)), { code: 'ENOENT' })
  } finally {
    await rm(fx.home, { recursive: true, force: true })
  }
})

const NEXT = `sk-ant-oat01-${'z9Y8_x7-'.repeat(12)}`

test('signing in again revokes the token it replaces', spawnsCli, async () => {
  const fx = await fixture()
  const revoked = []

  try {
    await signIn(fx, TOKEN, { revoke: async (token) => revoked.push(token) > 0 })
    assert.deepEqual(revoked, [])
    await signIn(fx, NEXT, { printed: NEXT, revoke: async (token) => revoked.push(token) > 0 })
    assert.deepEqual(revoked, [TOKEN])
    const stored = JSON.parse(await readFile(join(fx.configDir, LONG_LIVED_TOKEN_FILE), 'utf8'))

    assert.equal(stored.token, NEXT)
  } finally {
    await rm(fx.home, { recursive: true, force: true })
  }
})

test(
  'a revoke that fails keeps the new sign-in and says so without the token',
  spawnsCli,
  async () => {
    const fx = await fixture()
    const logged = []

    try {
      await signIn(fx, TOKEN)
      const frames = await signIn(fx, NEXT, {
        printed: NEXT,
        revoke: async () => false,
        log: (line) => logged.push(line),
      })
      const stored = JSON.parse(await readFile(join(fx.configDir, LONG_LIVED_TOKEN_FILE), 'utf8'))

      assert.equal(frames.at(-1).type, 'authenticated')
      assert.equal(stored.token, NEXT)
      assert.equal(logged.length, 1)
      assert.ok(!logged[0].includes(TOKEN) && !logged[0].includes(NEXT))
    } finally {
      await rm(fx.home, { recursive: true, force: true })
    }
  },
)

test('the revoke asks the provider as the CLI does, and a failure is only false', async () => {
  const calls = []
  const ok = await revokeLongLivedToken(TOKEN, async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })

    return { ok: true }
  })

  assert.equal(ok, true)
  assert.equal(calls[0].url, 'https://platform.claude.com/v1/oauth/token/revoke')
  assert.deepEqual(calls[0].body, {
    token: TOKEN,
    token_type_hint: 'access_token',
    client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  })
  assert.equal(await revokeLongLivedToken(TOKEN, async () => ({ ok: false })), false)
  assert.equal(
    await revokeLongLivedToken(TOKEN, async () => {
      throw new Error('offline')
    }),
    false,
  )
})
