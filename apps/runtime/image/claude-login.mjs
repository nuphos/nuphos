// Run through OpenAB's operator-gated `_openab/runtime/login`. stdout is a private
// NDJSON protocol, never pod logs. stdin carries the `code#state` the user pastes back
// (`_openab/runtime/login/input`). The credential stays in this container's
// `~/.claude/.credentials.json`, where the agent reads it; no frame carries it.
import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const AUTHORIZE_HOSTS = new Set(['claude.com', 'claude.ai'])
const CODE_LINE = /^[\w.~-]{1,2048}#[\w.~-]{1,512}$/u

export function authorizeUrl(output) {
  const match = /visit: (https:\/\/\S+)/u.exec(stripVTControlCharacters(output))

  if (!match) return null
  try {
    const url = new URL(match[1])

    return AUTHORIZE_HOSTS.has(url.hostname) && url.pathname.endsWith('/oauth/authorize')
      ? url.href
      : null
  } catch {
    return null
  }
}

export function isAuthorizationCode(line) {
  return CODE_LINE.test(line)
}

/** Claude's own answer to whether this environment is signed in. */
function signedIn(executable, args, env) {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...args, 'auth', 'status', '--json'],
      { env, timeout: 15_000 },
      (_error, stdout) => {
        try {
          resolve(JSON.parse(stdout).loggedIn === true)
        } catch {
          resolve(false)
        }
      },
    )
  })
}

class LoginError extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}

/**
 * Everything that decides where the login lands is a parameter: `home` and
 * `configDir` (a Box or a desktop's local agent has its own) come from the caller,
 * never from this process's environment. Only the CLI entrypoint below reads env, so
 * a test that passes a temp `home` can never touch the real login of the machine it
 * runs on.
 */
export async function runClaudeLogin({
  executable = 'claude',
  args = [],
  home,
  configDir = join(home, '.claude'),
  secureStorageConfigDir,
  user,
  input = process.stdin,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  signal,
}) {
  // Not the gateway's environment: no transport keys, and no CLAUDE_CODE_OAUTH_TOKEN,
  // which would shadow the login this writes. USER names the macOS Keychain account the
  // login is stored under; without it Claude stores it where the agent never looks.
  const env = {
    HOME: home,
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    TERM: 'dumb',
    CLAUDE_CONFIG_DIR: configDir,
    ...(secureStorageConfigDir !== undefined
      ? { CLAUDE_SECURESTORAGE_CONFIG_DIR: secureStorageConfigDir }
      : {}),
    ...(user ? { USER: user, LOGNAME: user } : {}),
  }
  const child = spawn(executable, [...args, 'auth', 'login', '--claudeai'], {
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    detached: process.platform !== 'win32',
  })
  const lines = createInterface({ input })
  let output = ''
  let announced = false
  let failure

  const stop = (reason) => {
    failure ??= new LoginError(reason)
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  }

  child.stdin.on('error', () => stop('failed'))
  child.stdout.on('data', (chunk) => {
    if (announced) return
    output = (output + chunk.toString()).slice(-16_384)
    const url = authorizeUrl(output)

    if (url) {
      announced = true
      emit({ type: 'authorize', url })
    }
  })
  lines.on('line', (line) => {
    const code = line.trim()

    if (isAuthorizationCode(code)) child.stdin.write(`${code}\n`)
  })
  // A gateway that cannot relay input hands this process /dev/null, which ends at once;
  // the code the user pastes could then never arrive.
  lines.on('close', () => stop('input_unavailable'))

  try {
    const code = await new Promise((resolve) => {
      const timeout = setTimeout(() => stop('failed'), 15 * 60_000)

      signal?.addEventListener('abort', () => stop('failed'), { once: true })
      child.once('error', () => stop('failed'))
      child.once('close', (exitCode) => {
        clearTimeout(timeout)
        resolve(exitCode)
      })
    })

    if (failure) throw failure
    if (code !== 0) throw new LoginError('failed')
    // The same check the agent's host runs, with the same environment, on every platform.
    if (!(await signedIn(executable, args, env))) throw new LoginError('failed')
    emit({ type: 'authenticated' })
  } finally {
    lines.removeAllListeners('close')
    lines.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()

  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => controller.abort())
  process.stdout.on('error', () => controller.abort())
  try {
    // The only place the environment is read: the runtime's own home and config dir.
    await runClaudeLogin({
      executable: process.env.CLAUDE_CODE_EXECUTABLE || 'claude',
      home: process.env.HOME ?? '/home/node',
      configDir: process.env.CLAUDE_CONFIG_DIR || undefined,
      secureStorageConfigDir: process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
      user: process.env.USER || process.env.LOGNAME,
      signal: controller.signal,
    })
  } catch (error) {
    // Provider output can contain sensitive values; report only a fixed reason.
    const reason = error instanceof LoginError ? error.reason : 'failed'

    process.stdout.write(`${JSON.stringify({ type: 'error', reason })}\n`)
    process.exitCode = 1
  }
}
