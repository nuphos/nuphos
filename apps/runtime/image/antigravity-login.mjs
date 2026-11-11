// The official CLI owns Google sign-in and its credential store. Only its authorize
// URL and the final result cross OpenAB's operator-gated login channel.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

export function authorizePrompt(output) {
  for (const [candidate] of stripVTControlCharacters(output).matchAll(
    /https:\/\/[^\s<>]+(?=\s)/gu,
  )) {
    try {
      const url = new URL(candidate)
      if (
        url.hostname === 'accounts.google.com' &&
        ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname) &&
        !url.username &&
        !url.password &&
        !url.port
      )
        return url.href
    } catch {
      /* Wait for a complete URL. */
    }
  }
  return null
}

export async function runAntigravityLogin({
  executable = process.env.NUPHOS_AGENT_EXECUTABLE || 'agy',
  env = process.env,
  input = process.stdin,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  signal,
} = {}) {
  if (signal?.aborted) throw new Error('Antigravity login cancelled')
  const home = env.NUPHOS_AGENT_HOME || env.HOME || '/home/node'
  const child = spawn(executable, ['acp', '--login'], {
    env: {
      ...Object.fromEntries(
        ['PATH', 'SystemRoot', 'ANTIGRAVITY_GEMINI_DIR'].flatMap((key) =>
          env[key] ? [[key, env[key]]] : [],
        ),
      ),
      HOME: home,
      USERPROFILE: home,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let output = ''
  let announced = false
  let cancelled = false
  const collect = (chunk) => {
    if (announced) return
    output = (output + chunk.toString()).slice(-16_384)
    const url = authorizePrompt(output)
    if (url) {
      announced = true
      emit({ type: 'authorize', url })
    }
  }
  const stop = () => {
    cancelled = true
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
      else child.kill()
    } catch {
      /* Already gone. */
    }
  }
  const lines = createInterface({ input })
  lines.on('line', (line) => {
    const code = line.trim()
    if (announced && code && code.length <= 4096) child.stdin.write(`${code}\n`)
  })
  lines.on('close', stop)
  child.stdin.on('error', stop)
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const timeout = setTimeout(stop, 15 * 60_000)
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const code = await new Promise((resolve) => {
      child.once('error', () => resolve(1))
      child.once('close', (exitCode) => resolve(exitCode))
    })
    if (code !== 0 || cancelled) throw new Error('Antigravity login did not complete')
    emit({ type: 'authenticated' })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', stop)
    lines.removeListener('close', stop)
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
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exitCode = 1
  }
}
