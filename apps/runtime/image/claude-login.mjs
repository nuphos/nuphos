// Run through OpenAB's operator-gated `_openab/runtime/login`. stdout is a private
// NDJSON protocol, never pod logs. stdin carries the `code#state` the user pastes back
// (`_openab/runtime/login/input`). The credential stays in this container's
// `~/.claude/.credentials.json`, where the agent reads it; no frame carries it.
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const AUTHORIZE_HOSTS = new Set(['claude.com', 'claude.ai'])
const CODE_LINE = /^[\w.~-]{1,2048}#[\w.~-]{1,512}$/u

export const CLAUDE_HOME = process.env.HOME ?? '/home/node'

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

class LoginError extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}

export async function runClaudeLogin({
  executable = process.env.CLAUDE_CODE_EXECUTABLE || 'claude',
  args = [],
  home = CLAUDE_HOME,
  input = process.stdin,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  signal,
} = {}) {
  const child = spawn(executable, [...args, 'auth', 'login', '--claudeai'], {
    // Not the gateway's environment: no transport keys, and no CLAUDE_CODE_OAUTH_TOKEN,
    // which would shadow the login this writes.
    env: { HOME: home, PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', TERM: 'dumb' },
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
    const credential = await stat(join(home, '.claude', '.credentials.json')).catch(() => null)

    if (!credential?.isFile() || credential.size === 0) throw new LoginError('failed')
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
    await runClaudeLogin({ signal: controller.signal })
  } catch (error) {
    // Provider output can contain sensitive values; report only a fixed reason.
    const reason = error instanceof LoginError ? error.reason : 'failed'

    process.stdout.write(`${JSON.stringify({ type: 'error', reason })}\n`)
    process.exitCode = 1
  }
}
