import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { deviceCodePrompt, runDeviceLogin } from '../image/codex-login.mjs'

const prompt =
  '1. Open this link\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n2. Enter this one-time code (expires in 15 minutes)\n   \x1b[94mABCD-EFGH\x1b[0m\n'

test('parses the pinned Codex CLI device prompt including ANSI without leaking output', () => {
  assert.deepEqual(deviceCodePrompt(prompt), {
    type: 'device',
    verificationUri: 'https://auth.openai.com/codex/device',
    userCode: 'ABCD-EFGH',
  })
  assert.equal(deviceCodePrompt('https://example.com\nEnter this one-time code\nABCD-EFGH\n'), null)
  assert.equal(deviceCodePrompt(prompt.slice(0, prompt.indexOf('ABCD'))), null)
  // An arbitrary stdout chunk can end halfway through the one-time code.
  assert.equal(deviceCodePrompt(prompt.slice(0, prompt.indexOf('EFGH') + 2)), null)
})

test('parallel device logins use separate temporary homes and never inherit account or transport credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-login-test-'))
  const script = join(directory, 'cli.mjs')

  try {
    await writeFile(
      script,
      `import { writeFileSync } from 'node:fs';
      const home = process.env.CODEX_HOME;
      if (process.argv.slice(-4).join('|') !== '-c|cli_auth_credentials_store="file"|login|--device-auth') process.exit(2);
      process.stdout.write(${JSON.stringify(prompt.slice(0, 70))});
      setTimeout(() => {
        process.stdout.write(${JSON.stringify(prompt.slice(70))});
        writeFileSync(home + '/auth.json', JSON.stringify({ home, env: process.env }));
      }, 20);`,
    )
    const run = async () => {
      const frames = []

      await runDeviceLogin({ args: [script], emit: (frame) => frames.push(frame) })
      assert.deepEqual(
        frames.map((frame) => frame.type),
        ['device', 'authenticated'],
      )
      const credential = JSON.parse(frames[1].authJson)

      assert.deepEqual(
        Object.keys(credential.env)
          .filter((name) => !['__CF_USER_TEXT_ENCODING', 'UV_USE_IO_URING'].includes(name))
          .sort(),
        ['CODEX_HOME', 'HOME', 'PATH', 'TERM'],
      )
      await assert.rejects(readFile(join(credential.home, 'auth.json')), { code: 'ENOENT' })

      return credential.home
    }
    const [a, b] = await Promise.all([run(), run()])

    assert.notEqual(a, b)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('--install writes the credential into this container and keeps it off the wire', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-login-install-test-'))
  const script = join(directory, 'cli.mjs')
  const codexHome = join(directory, 'nested', 'codex')
  const secret = JSON.stringify({ tokens: { access_token: 'do-not-emit-me' } })

  try {
    await writeFile(
      script,
      `import { writeFileSync } from 'node:fs';
      writeFileSync(process.env.CODEX_HOME + '/auth.json', ${JSON.stringify(secret)});`,
    )
    const frames = []

    await runDeviceLogin({
      args: [script],
      install: true,
      authDirectory: codexHome,
      emit: (frame) => frames.push(frame),
    })
    // The credential-free frame is the whole point: nothing outside the container
    // needs the credential, so nothing outside the container receives it.
    assert.deepEqual(frames, [{ type: 'authenticated' }])
    assert.equal(JSON.stringify(frames).includes('do-not-emit-me'), false)
    assert.equal(await readFile(join(codexHome, 'auth.json'), 'utf8'), secret)
    assert.equal((await stat(join(codexHome, 'auth.json'))).mode & 0o777, 0o600)
    // `seed-codex-auth.sh` compares this marker, so a self-installed credential has to
    // carry the same revision its own bytes would produce.
    assert.match(
      await readFile(join(codexHome, '.nuphos-auth-revision'), 'utf8'),
      /^[0-9a-f]{16}$/u,
    )
    await assert.rejects(readFile(join(codexHome, 'auth.json.new')), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('cancellation kills the CLI wrapper and native child before cleaning the temporary home', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-login-cancel-test-'))
  const script = join(directory, 'cli.mjs')
  const homeFile = join(directory, 'home')
  const nativeScript = join(directory, 'native.mjs')

  try {
    await writeFile(
      nativeScript,
      `import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(homeFile)}, process.env.CODEX_HOME);
      process.stdout.write(${JSON.stringify(prompt)});
      setInterval(() => writeFileSync(process.env.CODEX_HOME + '/auth.json', 'secret'), 20);`,
    )
    await writeFile(
      script,
      `import { spawn } from 'node:child_process';
      spawn(process.execPath, [${JSON.stringify(nativeScript)}], { stdio: 'inherit' });`,
    )
    const controller = new AbortController()
    const frames = []

    await assert.rejects(
      runDeviceLogin({
        args: [script],
        signal: controller.signal,
        emit: (frame) => {
          frames.push(frame)
          controller.abort()
        },
      }),
    )
    assert.deepEqual(
      frames.map((frame) => frame.type),
      ['device'],
    )
    const home = await readFile(homeFile, 'utf8')

    await assert.rejects(readFile(join(home, 'auth.json')), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
