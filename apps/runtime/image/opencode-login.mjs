// Run through OpenAB's operator-gated `_openab/runtime/login`. stdout is a private
// NDJSON protocol, never pod logs. OpenCode signs in to a ChatGPT plan with OpenAI's
// device code and writes the credential to `$XDG_DATA_HOME/opencode/auth.json` in this
// container; no frame carries it. Without a sign-in OpenCode still runs its free models.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

export const VERIFICATION_URI = 'https://auth.openai.com/codex/device'
const HOME = process.env.HOME ?? '/home/node'
export const AUTH_FILE = join(HOME, '.local', 'share', 'opencode', 'auth.json')

export function deviceCodePrompt(output) {
  const text = stripVTControlCharacters(output)
  if (!text.includes(`Go to: ${VERIFICATION_URI}`)) return null
  const userCode = /Enter code: ([A-Za-z0-9-]{4,32})\s/u.exec(text)?.[1]

  return userCode ? { type: 'device', verificationUri: VERIFICATION_URI, userCode } : null
}

export async function runOpenCodeLogin({
  executable = 'opencode',
  home = HOME,
  authFile = AUTH_FILE,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  signal,
} = {}) {
  const child = spawn(
    executable,
    ['providers', 'login', '--provider', 'openai', '--method', 'ChatGPT Pro/Plus (headless)'],
    {
      // Not the gateway's environment: no transport keys or session tokens.
      env: {
        HOME: home,
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  )
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
  // OpenCode exits 0 on a refused device code too; only a stored credential counts.
  const credential = await readFile(authFile, 'utf8')
    .then((text) => JSON.parse(text).openai)
    .catch(() => undefined)
  if (code !== 0 || !credential) throw new Error('OpenCode login did not complete')
  emit({ type: 'authenticated' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()

  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => controller.abort())
  process.stdout.on('error', () => controller.abort())
  try {
    await runOpenCodeLogin({ signal: controller.signal })
  } catch {
    // Provider output can contain sensitive values; report only a fixed reason.
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exitCode = 1
  }
}
