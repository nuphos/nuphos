import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const startScript = new URL('../image/runtime-start.sh', import.meta.url).pathname

// Pinned in nuphos's backend test too. The backend derives the operator key from the
// password it was given and the container derives it from the password it was started
// with; if these two drift, every self-hosted runtime silently loses its operator
// channel — status, pending decisions and Codex sign-in all go dark.
const VECTORS = [
  [
    'correct-horse-battery-staple-0123456789',
    '78e1724e5d59fee7238251e59f3571e4cb5587f14f649e324efae6f25b85ad8e',
  ],
  [
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'c4838404cd7d81464a7ee6e518c24d3c1a5fc4a22525944d79956be27bb990f2',
  ],
]

/** Run the start script with a probe in place of openab and report what it saw. */
function run(env, home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))) {
  const workspace = mkdtempSync(join(tmpdir(), 'nuphos-start-'))
  const keyFile = join(home, '.nuphos-runtime/auth-key')
  const result = spawnSync(
    'sh',
    [startScript, 'node', '-e', 'require("node:fs").writeSync(3, JSON.stringify(process.env))'],
    {
      env: {
        PATH: process.env.PATH,
        NUPHOS_RUNTIME_WORKSPACE: workspace,
        OPENAB_ACP_ENABLED: 'true',
        OPENAB_ACP_AUTH_KEY_FILE: keyFile,
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    },
  )

  return { result, workspace, home, keyFile }
}

function start(env, home) {
  const { result, ...rest } = run(env, home)

  assert.equal(result.status, 0, result.stderr)

  return {
    env: JSON.parse(result.output[3]),
    stdout: result.stdout,
    stderr: result.stderr,
    ...rest,
  }
}

test('the operator key is derived from the password alone', () => {
  for (const [password, expected] of VECTORS) {
    const { env } = start({ OPENAB_ACP_AUTH_KEY: password })

    assert.equal(env.OPENAB_ACP_CONTROL_KEY, expected)
    // openab refuses an operator key equal to the chat one, and floors it at 32.
    assert.notEqual(env.OPENAB_ACP_CONTROL_KEY, password)
    assert.ok(env.OPENAB_ACP_CONTROL_KEY.length >= 32)
    assert.equal(env.OPENAB_ACP_AUTH_KEY, password)
  }
})

test('an explicit operator key still wins, so provisioned pods are untouched', () => {
  // The provisioner sets both from a Secret; nothing here may second-guess that.
  const explicit = 'provisioner-issued-operator-key-0123456789abcdef'
  const { env } = start({
    OPENAB_ACP_AUTH_KEY: 'provisioner-issued-transport-key-0123456789',
    OPENAB_ACP_CONTROL_KEY: explicit,
  })

  assert.equal(env.OPENAB_ACP_CONTROL_KEY, explicit)
})

test('the same password pasted into both variables still yields a working operator key', () => {
  // openab would silently discard an operator key equal to the chat one, leaving the
  // operator channel dark with no error. Treat it as "one password" instead.
  const [password, expected] = VECTORS[0]
  const { env } = start({ OPENAB_ACP_AUTH_KEY: password, OPENAB_ACP_CONTROL_KEY: password })

  assert.equal(env.OPENAB_ACP_CONTROL_KEY, expected)
})

test('a password in the environment wins over the stored one', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))
  const first = start({}, home)
  const [password, expected] = VECTORS[0]
  const { env, stdout } = start({ OPENAB_ACP_AUTH_KEY: password }, home)

  assert.equal(env.OPENAB_ACP_AUTH_KEY, password)
  assert.equal(env.OPENAB_ACP_CONTROL_KEY, expected)
  assert.equal(stdout, '')
  assert.equal(readFileSync(first.keyFile, 'utf8').trim(), first.env.OPENAB_ACP_AUTH_KEY)
})

test('without a password one is generated once, stored privately, and announced once', () => {
  const { env, stdout, keyFile, home } = start({})
  const password = env.OPENAB_ACP_AUTH_KEY

  assert.match(password, /^[0-9a-f]{64}$/u)
  assert.equal(readFileSync(keyFile, 'utf8').trim(), password)
  assert.equal(statSync(keyFile).mode & 0o777, 0o600)
  assert.equal(statSync(join(home, '.nuphos-runtime')).mode & 0o777, 0o700)
  assert.deepEqual(readdirSync(join(home, '.nuphos-runtime')), ['auth-key'])
  assert.equal(stdout.split(password).length, 2)
  assert.match(stdout, /^Generated runtime password \(stored in [^)]+\): [0-9a-f]{64} — /u)
  assert.match(stdout, /persistent volume/u)
  assert.doesNotMatch(stdout, /WARNING/u)

  const again = start({}, home)

  assert.equal(again.env.OPENAB_ACP_AUTH_KEY, password)
  assert.equal(again.stdout.includes(password), false)
  assert.equal(again.stdout, `Using the runtime password from ${keyFile}.\n`)
})

test('the operator key is derived from the stored password', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))
  const [password, expected] = VECTORS[1]
  mkdirSync(join(home, '.nuphos-runtime'), { mode: 0o700 })
  writeFileSync(join(home, '.nuphos-runtime/auth-key'), `${password}\n`, { mode: 0o600 })

  const { env } = start({}, home)

  assert.equal(env.OPENAB_ACP_AUTH_KEY, password)
  assert.equal(env.OPENAB_ACP_CONTROL_KEY, expected)
})

test('the operator key is derived from a generated password', () => {
  const { env } = start({})

  assert.equal(
    env.OPENAB_ACP_CONTROL_KEY,
    createHmac('sha256', env.OPENAB_ACP_AUTH_KEY).update('nuphos-runtime-control-v1').digest('hex'),
  )
})

test('a home that has run before warns that the new password must be re-entered', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))
  const authFile = join(home, 'codex-auth.json')
  writeFileSync(authFile, '{}')

  const { stdout } = start({ OPENAB_RUNTIME_AUTH_FILE: authFile }, home)

  assert.match(stdout, /^WARNING: .*update it in every Nuphos workspace/u)
})

test('a custom key file in a directory it does not own leaves that directory alone', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))
  chmodSync(home, 0o755)
  const keyFile = join(home, 'runtime-password')

  const { env, stdout } = start({ OPENAB_ACP_AUTH_KEY_FILE: keyFile }, home)

  assert.equal(statSync(home).mode & 0o777, 0o755)
  assert.equal(statSync(keyFile).mode & 0o777, 0o600)
  assert.equal(readFileSync(keyFile, 'utf8').trim(), env.OPENAB_ACP_AUTH_KEY)
  assert.doesNotMatch(stdout, /WARNING/u)
})

test('a password that is too short fails the start, wherever it came from', () => {
  const fromEnv = run({ OPENAB_ACP_AUTH_KEY: 'too-short' })

  assert.notEqual(fromEnv.result.status, 0)
  assert.match(fromEnv.result.stderr, /at least 32/u)
  assert.equal(fromEnv.result.stderr.includes('too-short'), false)

  const home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))
  mkdirSync(join(home, '.nuphos-runtime'))
  writeFileSync(join(home, '.nuphos-runtime/auth-key'), 'short\n')
  const fromFile = run({}, home)

  assert.notEqual(fromFile.result.status, 0)
  assert.match(fromFile.result.stderr, /auth-key is 5 characters; it must be at least 32/u)
})

test('a home it cannot write fails the start instead of running without a password', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))
  chmodSync(home, 0o500)
  const { result } = run({}, home)
  chmodSync(home, 0o700)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /set OPENAB_ACP_AUTH_KEY/u)
})

test('with ACP off no password is needed, and none is invented', () => {
  const { env, stdout, keyFile } = start({ OPENAB_ACP_ENABLED: 'false' })

  assert.equal(env.OPENAB_ACP_AUTH_KEY, undefined)
  assert.equal(env.OPENAB_ACP_CONTROL_KEY, undefined)
  assert.equal(existsSync(keyFile), false)
  assert.equal(stdout, '')
})

test('the password never reaches argv or the output', () => {
  const [password] = VECTORS[0]
  const { stdout, stderr } = start({ OPENAB_ACP_AUTH_KEY: password })

  assert.equal(stdout.includes(password), false)
  assert.equal(stderr.includes(password), false)
  // node is handed the password through its environment; the script text passes no
  // variable on the command line.
  assert.doesNotMatch(readFileSync(startScript, 'utf8'), /node -e[^\n]*\$OPENAB_ACP_AUTH_KEY/u)
})

test('a token in the environment turns off sign-in and its status, and nothing else does', () => {
  const baked = {
    OPENAB_RUNTIME_LOGIN_COMMAND: 'node /opt/nuphos-runtime/claude-login.mjs',
    OPENAB_RUNTIME_AUTH_FILE: '/home/node/.claude/.credentials.json',
  }

  // The token outranks the stored login, so reporting the file would describe an
  // account the agent does not use — and a provisioned pod always has one.
  const withToken = start({ ...baked, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-operator' }).env

  assert.equal(withToken.OPENAB_RUNTIME_LOGIN_COMMAND, '')
  assert.equal(withToken.OPENAB_RUNTIME_AUTH_FILE, '')
  assert.equal(withToken.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-operator')

  for (const env of [baked, { ...baked, CLAUDE_CODE_OAUTH_TOKEN: '' }]) {
    const started = start(env).env

    assert.equal(started.OPENAB_RUNTIME_LOGIN_COMMAND, baked.OPENAB_RUNTIME_LOGIN_COMMAND)
    assert.equal(started.OPENAB_RUNTIME_AUTH_FILE, baked.OPENAB_RUNTIME_AUTH_FILE)
  }
})

test('with the console on, a fresh volume gets no password and points at the setup page', () => {
  const { env, stdout, keyFile, home } = start({ OPENAB_RUNTIME_CONSOLE: 'true' })

  assert.equal(env.OPENAB_ACP_AUTH_KEY, undefined)
  assert.equal(env.OPENAB_ACP_CONTROL_KEY, undefined)
  assert.equal(env.OPENAB_RUNTIME_LEGACY_KEY_FILE, keyFile)
  assert.equal(existsSync(join(home, '.nuphos-runtime')), false)
  assert.match(
    stdout,
    /^Open this runtime's address in a browser to set its console password\. Setup stays open for 30 minutes/u,
  )
})

test('with the console on, a stored password is left for openab to import, not exported', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuphos-home-'))
  const [password] = VECTORS[1]
  mkdirSync(join(home, '.nuphos-runtime'), { mode: 0o700 })
  writeFileSync(join(home, '.nuphos-runtime/auth-key'), `${password}\n`, { mode: 0o600 })

  const { env, stdout, keyFile } = start({ OPENAB_RUNTIME_CONSOLE: 'true' }, home)

  assert.equal(env.OPENAB_ACP_AUTH_KEY, undefined)
  assert.equal(env.OPENAB_ACP_CONTROL_KEY, undefined)
  assert.equal(env.OPENAB_RUNTIME_LEGACY_KEY_FILE, keyFile)
  assert.equal(stdout.includes(password), false)
  assert.equal(readFileSync(keyFile, 'utf8').trim(), password)

  writeFileSync(keyFile, 'short\n')
  const tooShort = run({ OPENAB_RUNTIME_CONSOLE: 'true' }, home)

  assert.notEqual(tooShort.result.status, 0)
  assert.match(tooShort.result.stderr, /at least 32/u)
})

test('with the console on, NUPHOS_RUNTIME_AUTOGEN_PASSWORD keeps the generated password', () => {
  const { env, stdout, keyFile } = start({
    OPENAB_RUNTIME_CONSOLE: 'true',
    NUPHOS_RUNTIME_AUTOGEN_PASSWORD: 'true',
  })
  const password = readFileSync(keyFile, 'utf8').trim()

  assert.match(password, /^[0-9a-f]{64}$/u)
  assert.equal(statSync(keyFile).mode & 0o777, 0o600)
  assert.match(stdout, /^Generated runtime password/u)
  assert.equal(env.OPENAB_ACP_AUTH_KEY, undefined, 'openab imports it from the file')
  assert.equal(env.OPENAB_RUNTIME_LEGACY_KEY_FILE, keyFile)
})

test('with the console on, a password in the environment still works as before', () => {
  const [password, expected] = VECTORS[0]
  const { env, stdout } = start({ OPENAB_RUNTIME_CONSOLE: 'true', OPENAB_ACP_AUTH_KEY: password })

  assert.equal(env.OPENAB_ACP_AUTH_KEY, password)
  assert.equal(env.OPENAB_ACP_CONTROL_KEY, expected)
  assert.equal(stdout, '')
})

test('the workspace is laid out the way a provisioned pod lays it out', () => {
  const { workspace } = start({ OPENAB_ACP_AUTH_KEY: VECTORS[0][0] })

  assert.equal(existsSync(join(workspace, '.claude')), true)
  assert.equal(readlinkSync(join(workspace, 'skills')), '.claude/skills')
  // Codex reads its own path, and deduplicates by absolute path.
  assert.equal(readlinkSync(join(workspace, '.agents/skills')), '../.claude/skills')

  // Starting again finds the layout in place and leaves it alone.
  const again = spawnSync('sh', [startScript, 'true'], {
    env: { PATH: process.env.PATH, NUPHOS_RUNTIME_WORKSPACE: workspace },
    encoding: 'utf8',
  })

  assert.equal(again.status, 0, again.stderr)
  assert.equal(readlinkSync(join(workspace, 'skills')), '.claude/skills')
})

test('an unwritable workspace does not stop the runtime starting', () => {
  const result = spawnSync('sh', [startScript, 'true'], {
    env: { PATH: process.env.PATH, NUPHOS_RUNTIME_WORKSPACE: '/proc/nuphos-cannot-exist' },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
})

test('with no command it becomes openab with the baked config', () => {
  // Stub openab on PATH to record how it was invoked.
  const bin = mkdtempSync(join(tmpdir(), 'nuphos-start-bin-'))
  const record = join(bin, 'argv')

  spawnSync('sh', [
    '-c',
    `printf '#!/bin/sh\\nprintf "%%s " "$@" > ${record}\\n' > ${bin}/openab && chmod +x ${bin}/openab`,
  ])
  const result = spawnSync('sh', [startScript], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      NUPHOS_RUNTIME_WORKSPACE: mkdtempSync(join(tmpdir(), 'nuphos-start-')),
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(record, 'utf8').trim(), 'run -c /etc/openab/config.toml')
})
