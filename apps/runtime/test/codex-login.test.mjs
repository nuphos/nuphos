import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { PassThrough } from 'node:stream'

import { deviceCodePrompt, loginChoice, runDeviceLogin } from '../image/codex-login.mjs'

// A managed runtime's login is the file its agent signs in with. These tests only ever
// write where they are told to, but on such a pod they do not spawn a CLI at all.
const onManagedRuntime =
  process.env.HOME?.startsWith('/home/node') === true &&
  Object.keys(process.env).some((name) => name.startsWith('NUPHOS_RUNTIME'))
const spawnsCli = { skip: onManagedRuntime && 'never spawns a sign-in on a managed runtime' }

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

test(
  'parallel device logins use separate temporary homes and never inherit account or transport credentials',
  spawnsCli,
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-login-test-'))
    const script = join(directory, 'cli.mjs')

    try {
      // The wrapper reads the credential back from the fresh CODEX_HOME it made for this
      // one login, so that directory, never the runner's, is where the fixture writes.
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

        await runDeviceLogin({
          args: [script],
          home: directory,
          emit: (frame) => frames.push(frame),
        })
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
        // The child's HOME is the one the caller pinned, not the runner's.
        assert.equal(credential.env.HOME, directory)
        // An npm-installed CLI finds node through the caller's PATH.
        assert.equal(credential.env.PATH, process.env.PATH)
        await assert.rejects(readFile(join(credential.home, 'auth.json')), { code: 'ENOENT' })

        return credential.home
      }
      const [a, b] = await Promise.all([run(), run()])

      assert.notEqual(a, b)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test(
  '--install writes the credential into this container and keeps it off the wire',
  spawnsCli,
  async () => {
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
        home: directory,
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
  },
)

test(
  'cancellation kills the CLI wrapper and native child before cleaning the temporary home',
  spawnsCli,
  async () => {
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
          home: directory,
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
  },
)

const API_KEY = 'sk-proj-test-key-not-real-0123456789'

test('only an API key or a sign-out replaces the device sign-in', () => {
  assert.deepEqual(loginChoice(`${API_KEY}\n`), { apiKey: API_KEY })
  assert.deepEqual(loginChoice('sign-out'), { signOut: true })
  assert.equal(loginChoice('sk-short'), null)
  // An Anthropic key is for Claude Code, not Codex.
  assert.equal(loginChoice('sk-ant-api03-not-an-openai-key-0123456789'), null)
  assert.equal(loginChoice(`echo ${API_KEY}`), null)
})

test(
  'an API key sent while the device sign-in waits is installed with `codex login --with-api-key`',
  spawnsCli,
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-login-key-test-'))
    const script = join(directory, 'cli.mjs')
    const codexHome = join(directory, 'codex')

    try {
      // The device sign-in waits forever; the key sign-in stores what stdin carries.
      await writeFile(
        script,
        `import { readFileSync, writeFileSync } from 'node:fs';
      if (process.argv.at(-1) === '--device-auth') {
        process.stdout.write(${JSON.stringify(prompt)});
        setInterval(() => {}, 1000);
      } else if (process.argv.at(-1) === '--with-api-key') {
        const key = readFileSync(0, 'utf8').trim();
        writeFileSync(process.env.CODEX_HOME + '/auth.json', JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: key }), { mode: 0o600 });
      } else process.exit(2);`,
      )
      const sendWhenAsked = (input, line, frames) => (frame) => {
        frames.push(frame)
        if (frame.type === 'device') input.write(`${line}\n`)
      }
      const run = (line, install = true) => {
        const input = new PassThrough()
        const frames = []
        const done = runDeviceLogin({
          args: [script],
          home: directory,
          install,
          authDirectory: codexHome,
          input,
          emit: sendWhenAsked(input, line, frames),
        })

        return { frames, done }
      }
      let attempt = run(API_KEY)

      await attempt.done
      assert.deepEqual(
        attempt.frames.map((frame) => frame.type),
        ['device', 'authenticated'],
      )
      assert.equal(JSON.stringify(attempt.frames).includes(API_KEY), false)
      assert.deepEqual(JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')), {
        auth_mode: 'apikey',
        OPENAI_API_KEY: API_KEY,
      })
      assert.equal((await stat(join(codexHome, 'auth.json'))).mode & 0o777, 0o600)

      attempt = run('sign-out')
      await attempt.done
      assert.deepEqual(
        attempt.frames.map((frame) => frame.type),
        ['device', 'signedOut'],
      )
      await assert.rejects(readFile(join(codexHome, 'auth.json')), { code: 'ENOENT' })

      // A sign-out leaves an account sign-in alone.
      await writeFile(join(codexHome, 'auth.json'), '{"tokens":{}}')
      await run('sign-out').done
      assert.equal(await readFile(join(codexHome, 'auth.json'), 'utf8'), '{"tokens":{}}')

      // The path that hands the credential back never takes a key.
      await assert.rejects(
        runDeviceLogin({ args: [script], home: directory, apiKey: API_KEY }),
        /refused/u,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test('`--api-key` reads the key from stdin and `--sign-out` removes it', spawnsCli, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-login-direct-test-'))
  const cli = join(directory, 'codex')
  const codexHome = join(directory, 'codex-home')
  const wrapper = fileURLToPath(new URL('../image/codex-login.mjs', import.meta.url))
  const run = (flag, input) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [wrapper, '--install', flag], {
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          CODEX_EXECUTABLE: cli,
          NUPHOS_CODEX_AUTH_DIRECTORY: codexHome,
        },
      })
      let out = ''
      child.stdout.on('data', (chunk) => (out += chunk))
      child.on('close', () => resolve(JSON.parse(out.trim()).type))
      child.stdin.end(input)
    })

  try {
    await writeFile(
      cli,
      `#!${process.execPath}\nimport { readFileSync, writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CODEX_HOME + '/auth.json', JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: readFileSync(0, 'utf8').trim() }));\n`,
      { mode: 0o755 },
    )
    assert.equal(await run('--api-key', `${API_KEY}\n`), 'authenticated')
    assert.equal(
      JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')).OPENAI_API_KEY,
      API_KEY,
    )
    assert.equal(await run('--sign-out', '\n'), 'signedOut')
    await assert.rejects(readFile(join(codexHome, 'auth.json')), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
