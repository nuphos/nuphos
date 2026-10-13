// Run through OpenAB's operator-gated `_openab/runtime/login`. stdout is a private
// NDJSON protocol, never pod logs. `grok login --device-auth` writes the credential to
// `$GROK_HOME/auth.json` in this container; no frame carries it.
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

export const VERIFICATION_URI = 'https://accounts.x.ai/oauth2/device'
export const GROK_HOME = join(process.env.HOME ?? '/home/node', '.grok')

export function deviceCodePrompt(output) {
  const userCode = new RegExp(
    `${VERIFICATION_URI.replaceAll('.', '\\.')}\\?user_code=([A-Za-z0-9-]{4,32})\\s`,
    'u',
  ).exec(stripVTControlCharacters(output))?.[1]

  return userCode ? { type: 'device', verificationUri: VERIFICATION_URI, userCode } : null
}

export async function runGrokLogin({
  executable = 'grok',
  home = GROK_HOME,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  signal,
} = {}) {
  const child = spawn(executable, ['login', '--device-auth'], {
    // Not the gateway's environment: no transport keys or session tokens.
    env: {
      HOME: process.env.HOME ?? '/home/node',
      GROK_HOME: home,
      GROK_DISABLE_AUTOUPDATER: '1',
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
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
    const prompt = deviceCodePrompt(output)
    if (prompt) {
      announced = true
      emit(prompt)
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
  const credential = await stat(join(home, 'auth.json')).catch(() => null)
  if (code !== 0 || !credential?.isFile() || credential.size === 0)
    throw new Error('Grok login did not complete')
  emit({ type: 'authenticated' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()

  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => controller.abort())
  process.stdout.on('error', () => controller.abort())
  try {
    await runGrokLogin({ signal: controller.signal })
  } catch {
    // Provider output can contain sensitive values; report only a fixed reason.
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exitCode = 1
  }
}
