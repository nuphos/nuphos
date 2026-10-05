// Run through OpenAB's operator-gated `_openab/runtime/login`. stdout is a private
// NDJSON protocol, never pod logs.
//
// Antigravity signs in with Google's loopback OAuth: the ACP server listens on
// 127.0.0.1 in this container and Google redirects the user's browser there, where
// nothing answers. The user pastes that address back (stdin, through
// `_openab/runtime/login/input`) and this script delivers it to the listener. The
// credential stays under `$GEMINI_HOME`; no frame carries it.
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

export const GEMINI_HOME = join(process.env.HOME ?? '/home/node', '.gemini')
const AUTHORIZE = /(https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?\S+)/u

/** Google's authorize URL and the loopback port it sends the browser back to. */
export function authorizePrompt(output) {
  const match = AUTHORIZE.exec(output)
  if (!match) return null
  try {
    const url = new URL(match[1])
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
    if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1') return null
    return { url: url.href, port: redirect.port }
  } catch {
    return null
  }
}

/** The address the browser could not open, on exactly the listener's port, and nothing else. */
export function callbackUrl(line, port) {
  try {
    const url = new URL(line.trim())
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if (url.protocol !== 'http:' || !loopback || url.port !== port) return null
    if (!url.searchParams.get('code') && !url.searchParams.get('error')) return null
    return `http://127.0.0.1:${port}${url.pathname}${url.search}`
  } catch {
    return null
  }
}

export async function runAntigravityLogin({
  executable = 'agy-acp-server',
  home = GEMINI_HOME,
  input = process.stdin,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  signal,
} = {}) {
  const child = spawn(executable, [], {
    // Not the gateway's environment. BROWSER keeps it from trying to open one.
    env: {
      HOME: process.env.HOME ?? '/home/node',
      GEMINI_HOME: home,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      BROWSER: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const lines = createInterface({ input })
  let prompt
  let stderr = ''
  let failure = false
  const stop = () => {
    failure = true
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  }
  child.stderr.on('data', (chunk) => {
    if (prompt) return
    stderr = (stderr + chunk.toString()).slice(-16_384)
    prompt = authorizePrompt(stderr)
    if (prompt) emit({ type: 'authorize', url: prompt.url })
  })
  lines.on('line', (line) => {
    const callback = prompt && callbackUrl(line, prompt.port)
    if (callback) fetch(callback).catch(() => {})
  })
  // A gateway that cannot relay input hands this process /dev/null, which ends at once.
  lines.on('close', () => {
    if (!failure) stop()
  })

  const authenticated = new Promise((resolve) => {
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line)
        if (message.id === 2) resolve(!message.error)
      } catch {
        /* Not a frame. */
      }
    })
    child.once('close', () => resolve(false))
    child.once('error', () => resolve(false))
  })
  const timeout = setTimeout(stop, 15 * 60_000)
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
    send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })
    send({ id: 2, method: 'authenticate', params: { methodId: 'oauth-personal' } })
    if (!(await authenticated) || failure) throw new Error('Antigravity login did not complete')
    // Sessions do not call authenticate, so the server needs the method recorded.
    const settingsDir = join(home, 'antigravity-acp')
    const settingsPath = join(settingsDir, 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8').catch(() => '{}'))
    await mkdir(settingsDir, { recursive: true, mode: 0o700 })
    await writeFile(
      settingsPath,
      `${JSON.stringify({ ...settings, auth: { ...settings.auth, type: 'oauth-personal' } }, null, 2)}\n`,
      { mode: 0o600 },
    )
    emit({ type: 'authenticated' })
  } finally {
    clearTimeout(timeout)
    lines.removeAllListeners('close')
    lines.close()
    stop()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()

  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => controller.abort())
  process.stdout.on('error', () => controller.abort())
  try {
    await runAntigravityLogin({ signal: controller.signal })
  } catch {
    // Provider output can contain sensitive values; report only a fixed reason.
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exitCode = 1
  }
}
