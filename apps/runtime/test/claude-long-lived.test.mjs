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
  process.stdout.write('Your OAuth token (valid for 1y):\\n\\x1b[33m${TOKEN}\\x1b[39m\\nStore this token securely.\\n');
  process.exit(0);
});
`

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'claude-long-lived-test-'))
  const script = join(home, 'cli.mjs')

  await writeFile(script, FAKE_CLI)

  return { home, script, record: join(home, 'record.ndjson'), configDir: join(home, '.claude') }
}

async function signIn({ home, script, record, configDir }, accepted) {
  await writeFile(`${record}.accepted`, accepted)
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
