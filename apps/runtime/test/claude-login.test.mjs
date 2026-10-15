import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { authorizeUrl, isAuthorizationCode, runClaudeLogin } from '../image/claude-login.mjs'

// A managed runtime's login is the file its agent signs in with. These tests only ever
// write where they are told to, but on such a pod they do not spawn a CLI at all.
const onManagedRuntime =
  process.env.HOME?.startsWith('/home/node') === true &&
  Object.keys(process.env).some((name) => name.startsWith('NUPHOS_RUNTIME'))
const spawnsCli = { skip: onManagedRuntime && 'never spawns a sign-in on a managed runtime' }
// The wrapper only checks for a credential file off macOS; there the Keychain holds it.
const checksCredentialFile = {
  skip:
    spawnsCli.skip ||
    (process.platform === 'darwin' && 'macOS keeps the login in the Keychain, not in a file'),
}

const URL_LINE =
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=c&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s\n"

// What `claude auth login --claudeai` does without a TTY in the pinned CLI: print the
// manual URL, then read `code#state` lines from stdin and store the credential. The
// fixture stores it at the path the test passes as its first argument, never anywhere
// its environment points: in a managed runtime HOME is the runtime's real sign-in, and
// a test run there once overwrote it (NUPS-1172). A wrapper that leaked the wrong HOME
// or CLAUDE_CONFIG_DIR is caught by the recorded values, not by a file landing in the
// real login.
const FAKE_CLI = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
const target = process.argv[2];
if (process.argv.slice(-3).join(' ') !== 'auth login --claudeai') process.exit(2);
process.stdout.write('Opening browser to sign in\\u2026\\n' + ${JSON.stringify(URL_LINE)} + 'Paste code here if prompted > ');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.includes('#')) process.exit(3);
  if (line !== 'good-code#state') process.exit(4);
  if (process.env.SKIP_WRITE !== '1') {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ env: Object.keys(process.env), home: process.env.HOME, configDir: process.env.CLAUDE_CONFIG_DIR }));
  }
  process.stdout.write('Login successful.\\n');
  process.exit(0);
});
`

const HOST_NOISE = ['__CF_USER_TEXT_ENCODING', 'UV_USE_IO_URING']

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'claude-login-test-'))
  const script = join(home, 'cli.mjs')

  await writeFile(script, FAKE_CLI)

  return { home, script }
}

function login({ script, credential, input, emit = () => {}, ...rest }) {
  return runClaudeLogin({
    executable: process.execPath,
    args: [script, credential],
    input,
    emit,
    ...rest,
  })
}

const pasteWhenAsked = (input) => (frame) => {
  if (frame.type === 'authorize') input.write('good-code#state\n')
}

test('reads the authorize URL the pinned CLI prints and refuses any other destination', () => {
  assert.equal(
    authorizeUrl(`\x1b[2mOpening browser\x1b[0m\n${URL_LINE}`),
    URL_LINE.slice(URL_LINE.indexOf('https://')).trim(),
  )
  assert.equal(
    authorizeUrl('visit: https://claude.ai/oauth/authorize?x=1'),
    'https://claude.ai/oauth/authorize?x=1',
  )
  assert.equal(authorizeUrl('visit: https://evil.example/oauth/authorize?x=1'), null)
  assert.equal(authorizeUrl('visit: https://claude.com/somewhere-else'), null)
  assert.equal(authorizeUrl('visit: http://claude.com/cai/oauth/authorize'), null)
  assert.equal(authorizeUrl(URL_LINE.slice(0, 20)), null)
})

test('only a single code#state line is treated as an authorization code', () => {
  assert.ok(isAuthorizationCode('abc-DEF_123#uoYDTanuto1Cz7W8Xq0pIbvDZZoNqnLELe6UFQ3qf7M'))
  assert.ok(!isAuthorizationCode('abc'))
  assert.ok(!isAuthorizationCode('a#b#c'))
  assert.ok(!isAuthorizationCode('a b#c'))
  assert.ok(!isAuthorizationCode('#state'))
})

test(
  'the pasted code signs the runtime in and the credential never leaves it',
  spawnsCli,
  async () => {
    const { home, script } = await fixture()
    const credential = join(home, '.claude', '.credentials.json')
    const input = new PassThrough()
    const frames = []

    try {
      await login({
        script,
        credential,
        home,
        input,
        emit: (frame) => {
          frames.push(frame)
          if (frame.type === 'authorize') {
            input.write('not a code\n')
            input.write('good-code#state\n')
          }
        },
      })
      assert.deepEqual(frames, [
        { type: 'authorize', url: URL_LINE.slice(URL_LINE.indexOf('https://')).trim() },
        { type: 'authenticated' },
      ])
      const stored = JSON.parse(await readFile(credential, 'utf8'))

      // The child sees exactly the home and config dir the caller chose, and nothing else.
      assert.deepEqual(stored.env.filter((name) => !HOST_NOISE.includes(name)).sort(), [
        'CLAUDE_CONFIG_DIR',
        'HOME',
        'PATH',
        'TERM',
      ])
      assert.equal(stored.home, home)
      assert.equal(stored.configDir, join(home, '.claude'))
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
)

test(
  'an ambient CLAUDE_CONFIG_DIR is ignored: the caller decides where the login lands',
  spawnsCli,
  async () => {
    const { home, script } = await fixture()
    const configDir = join(home, 'runtime-config')
    const ambient = join(home, 'ambient-config')
    const input = new PassThrough()
    const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }

    // What a managed runtime pod or a desktop's local agent has in its environment.
    process.env.HOME = join(home, 'ambient-home')
    process.env.CLAUDE_CONFIG_DIR = ambient
    try {
      await login({
        script,
        credential: join(configDir, '.credentials.json'),
        home,
        configDir,
        input,
        emit: pasteWhenAsked(input),
      })
      const stored = JSON.parse(await readFile(join(configDir, '.credentials.json'), 'utf8'))

      assert.equal(stored.home, home)
      assert.equal(stored.configDir, configDir)
      await assert.rejects(readFile(join(ambient, '.credentials.json')), { code: 'ENOENT' })
    } finally {
      process.env.HOME = saved.HOME
      if (saved.CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = saved.CLAUDE_CONFIG_DIR
      await rm(home, { recursive: true, force: true })
    }
  },
)

test(
  'a credential that only exists in the ambient config dir does not count as a sign-in',
  checksCredentialFile,
  async () => {
    const { home, script } = await fixture()
    const ambient = join(home, 'ambient-config')
    const input = new PassThrough()
    const saved = process.env.CLAUDE_CONFIG_DIR

    await mkdir(ambient, { recursive: true })
    await writeFile(join(ambient, '.credentials.json'), '{"claudeAiOauth":{}}')
    process.env.CLAUDE_CONFIG_DIR = ambient
    try {
      // The CLI stores nothing; the only credential on disk is the ambient one.
      await assert.rejects(
        runClaudeLogin({
          executable: 'sh',
          args: ['-c', `SKIP_WRITE=1 exec "${process.execPath}" "${script}" "$@"`, 'sh', 'unused'],
          home,
          input,
          emit: pasteWhenAsked(input),
        }),
        { reason: 'failed' },
      )
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = saved
      await rm(home, { recursive: true, force: true })
    }
  },
)

test(
  'a gateway that cannot relay the code fails at once instead of waiting 15 minutes',
  spawnsCli,
  async () => {
    const { home, script } = await fixture()
    const input = new PassThrough()

    input.end()
    try {
      await assert.rejects(login({ script, credential: join(home, 'unused'), home, input }), {
        reason: 'input_unavailable',
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
)

test(
  'a CLI that exits cleanly without storing a credential is not a sign-in',
  checksCredentialFile,
  async () => {
    const { home, script } = await fixture()
    const input = new PassThrough()

    try {
      await assert.rejects(
        runClaudeLogin({
          executable: 'sh',
          args: ['-c', `SKIP_WRITE=1 exec "${process.execPath}" "${script}" "$@"`, 'sh', 'unused'],
          home,
          input,
          emit: pasteWhenAsked(input),
        }),
        { reason: 'failed' },
      )
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
)
