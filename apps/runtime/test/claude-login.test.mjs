import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { authorizeUrl, isAuthorizationCode, runClaudeLogin } from '../image/claude-login.mjs'

const URL_LINE =
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=c&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s\n"

// What `claude auth login --claudeai` does without a TTY in the pinned CLI: print the
// manual URL, then read `code#state` lines from stdin and store the credential.
const FAKE_CLI = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
if (process.argv.slice(-3).join(' ') !== 'auth login --claudeai') process.exit(2);
process.stdout.write('Opening browser to sign in\\u2026\\n' + ${JSON.stringify(URL_LINE)} + 'Paste code here if prompted > ');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.includes('#')) process.exit(3);
  if (line !== 'good-code#state') process.exit(4);
  if (process.env.SKIP_WRITE !== '1') {
    mkdirSync(process.env.HOME + '/.claude', { recursive: true });
    writeFileSync(process.env.HOME + '/.claude/.credentials.json', JSON.stringify({ env: Object.keys(process.env) }));
  }
  process.stdout.write('Login successful.\\n');
  process.exit(0);
});
`

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'claude-login-test-'))
  const script = join(home, 'cli.mjs')

  await writeFile(script, FAKE_CLI)

  return { home, script }
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

test('the pasted code signs the runtime in and the credential never leaves it', async () => {
  const { home, script } = await fixture()
  const input = new PassThrough()
  const frames = []

  try {
    await runClaudeLogin({
      executable: process.execPath,
      args: [script],
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
    const stored = JSON.parse(await readFile(join(home, '.claude', '.credentials.json'), 'utf8'))

    assert.deepEqual(
      stored.env
        .filter((name) => !['__CF_USER_TEXT_ENCODING', 'UV_USE_IO_URING'].includes(name))
        .sort(),
      ['HOME', 'PATH', 'TERM'],
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a gateway that cannot relay the code fails at once instead of waiting 15 minutes', async () => {
  const { home, script } = await fixture()
  const input = new PassThrough()

  input.end()
  try {
    await assert.rejects(
      runClaudeLogin({ executable: process.execPath, args: [script], home, input, emit: () => {} }),
      { reason: 'input_unavailable' },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a CLI that exits cleanly without storing a credential is not a sign-in', async () => {
  const { home, script } = await fixture()
  const input = new PassThrough()

  try {
    await assert.rejects(
      runClaudeLogin({
        executable: 'sh',
        args: ['-c', `SKIP_WRITE=1 exec "${process.execPath}" "${script}" "$@"`, 'sh'],
        home,
        input,
        emit: (frame) => {
          if (frame.type === 'authorize') input.write('good-code#state\n')
        },
      }),
      { reason: 'failed' },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
