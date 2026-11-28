// Run through OpenAB's operator-gated `_openab/runtime/login`, with the frames of
// opencode-login.mjs. `cursor-agent login` prints a cursor.com page and polls until the
// user approves it there, so its page becomes a `browser` step with nothing to paste back.
// The CLI writes the credential to its auth.json in the agent's home (the file store, not
// a system keychain, which every home on the computer shares); no frame carries it.
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

// A computer running Cursor as a local agent names its own CLI and home.
const HOME = process.env.NUPHOS_AGENT_HOME || process.env.HOME || '/home/node'
const CURSOR = process.env.NUPHOS_AGENT_EXECUTABLE || 'cursor-agent'

/** Where the Cursor CLI keeps its login in `home` with the file store. */
export function cursorAuthFile(home, platform = process.platform) {
  return platform === 'darwin'
    ? join(home, '.cursor', 'auth.json')
    : join(home, '.config', 'cursor', 'auth.json')
}

/** The environment every Cursor CLI process runs with: its login in `home`, as a file. */
export function cursorEnv(home) {
  return { AGENT_CLI_CREDENTIAL_STORE: 'file', HOME: home }
}

/** The cursor.com page `cursor-agent login` asks the user to open. */
export function loginPage(output) {
  const url = /https:\/\/cursor\.com\/loginDeepControl\?\S+/u.exec(
    stripVTControlCharacters(output),
  )?.[0]
  return url ? { type: 'browser', url } : null
}

export async function runCursorLogin({
  executable = CURSOR,
  home = HOME,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  signal,
} = {}) {
  const child = spawn(executable, ['login'], {
    // Not the gateway's environment: no transport keys or session tokens.
    env: {
      ...cursorEnv(home),
      USERPROFILE: home,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      NO_OPEN_BROWSER: '1',
      TERM: 'dumb',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let output = ''
  let announced = false
  const collect = (chunk) => {
    if (announced) return
    output = (output + chunk.toString()).slice(-16_384)
    const page = loginPage(output)
    if (page) {
      announced = true
      emit(page)
    }
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  }
  const code = await new Promise((resolve) => {
    const timeout = setTimeout(stop, 15 * 60_000)
    signal?.addEventListener('abort', stop, { once: true })
    child.once('error', () => resolve(1))
    child.once('close', (exitCode) => {
      clearTimeout(timeout)
      resolve(exitCode)
    })
  })
  const credential = await stat(cursorAuthFile(home)).catch(() => null)
  if (code !== 0 || !credential?.isFile() || credential.size === 0)
    throw new Error('Cursor login did not complete')
  emit({ type: 'authenticated' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()

  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => controller.abort())
  process.stdout.on('error', () => controller.abort())
  try {
    await runCursorLogin({ signal: controller.signal })
  } catch {
    // Provider output can contain sensitive values; report only a fixed reason.
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exitCode = 1
  }
}
