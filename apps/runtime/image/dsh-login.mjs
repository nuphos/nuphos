// Run through OpenAB's operator-gated `_openab/runtime/login`. stdout is a private
// NDJSON protocol, never pod logs; stdin carries one answer per line. Frames are
// OpenCode's (see opencode-login.mjs).
//
// DeepSeek Harness signs in with a DeepSeek API key or a DeepSeek account. Its ACP server
// offers no sign-in, so this boots the same `acp` profile once more with a `--patch`
// overlay: the ACP server off, DSH's web server on a loopback port for the account's
// OAuth callback, and dsh-sign-in.mjs, which asks DSH's own services to sign in. DSH
// writes the credential to `$DSH_HOME/.credentials.yaml`; no frame carries it.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { pastedAddress } from './opencode-login.mjs'

// A computer running DSH as a local agent names its own CLI and the home it runs with.
const HOME = process.env.NUPHOS_AGENT_HOME || process.env.HOME || '/home/node'
// Where the ACP shim points DSH_HOME, whatever the computer's own DSH_HOME is.
const DSH_HOME = join(HOME, '.dsh')
const DSH_EXECUTABLE = process.env.NUPHOS_AGENT_EXECUTABLE || 'dsh'
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), 'dsh-sign-in.mjs')
const METHODS = [
  { value: 'account', label: 'DeepSeek account' },
  { value: 'api-key', label: 'DeepSeek API key' },
]
// The `acp` profile starts every session on the API-key route; an account needs its own.
const ACCOUNT_PROFILE_PATCH = `# Written by Nuphos after a DeepSeek account sign-in.
- id: acp
  config:
    provider: deepseek-account
    model: deepseek-v4-pro
`

class LoginError extends Error {}

/** The overlay that turns the `acp` profile into a one-shot sign-in. */
export function signInPatch({ plugin, port }) {
  const server = port
    ? `    - id: nuphos-sign-in-server
      name: '@deepseek-ai/dsh-host-webserver'
      config:
        host: 127.0.0.1
        port: ${String(port)}
`
    : ''
  return `- id: acp
  disabled: true
- insert:
${server}    - id: nuphos-sign-in
      name: ${JSON.stringify(plugin)}
`
}

/** Points the `acp` profile at the account route, or back to its shipped API-key default. */
export async function setDefaultProvider(dshHome, account) {
  const file = join(dshHome, 'profiles', 'acp', 'cordis.patch.yml')
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, account ? ACCOUNT_PROFILE_PATCH : '[]\n', { mode: 0o600 })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function dshVersion() {
  return new Promise((resolve) => {
    const child = spawn(DSH_EXECUTABLE, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.once('error', () => resolve(undefined))
    child.once('close', () => resolve(output.trim() || undefined))
  })
}

/** DSH with the sign-in overlay; resolves its frames, its stdin and a stop. */
export async function startSignIn({ method }) {
  const port = method === 'account' ? await freePort() : undefined
  const dir = await mkdtemp(join(tmpdir(), 'nuphos-dsh-sign-in-'))
  const patch = join(dir, 'sign-in.patch.yml')
  await writeFile(patch, signInPatch({ plugin: PLUGIN, port }), { mode: 0o600 })
  const version = await dshVersion()
  const child = spawn(DSH_EXECUTABLE, ['--profile', 'acp', '--patch', patch], {
    // Not the gateway's environment: no transport keys or session tokens.
    env: {
      HOME,
      DSH_HOME,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      TERM: 'dumb',
      NUPHOS_DSH_SIGN_IN: method,
      ...(port ? { NUPHOS_DSH_SIGN_IN_PORT: String(port) } : {}),
      ...(version ? { NUPHOS_DSH_VERSION: version } : {}),
    },
    cwd: HOME,
    // In this helper's process group, so stopping the sign-in stops DSH too.
    stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
  })
  const exited = new Promise((resolve) => child.once('close', resolve))
  child.once('error', () => {})
  // Whatever ends this process, DSH goes with it.
  process.once('exit', () => child.kill('SIGKILL'))
  const frames = createInterface({ input: child.stdio[3] })[Symbol.asyncIterator]()
  return {
    port,
    frames: {
      async next() {
        const line = await Promise.race([frames.next(), exited.then(() => ({ done: true }))])
        if (line.done) throw new LoginError('DSH exited')
        return JSON.parse(line.value)
      },
    },
    write: (text) => child.stdin.write(`${text}\n`),
    stop: () => {
      child.kill('SIGKILL')
      rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

export async function runDshLogin({
  lines,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  start = startSignIn,
  fetchImpl = fetch,
  dshHome = DSH_HOME,
}) {
  const answer = async () => {
    const { value, done } = await lines.next()
    if (done) throw new LoginError('No answer')
    return value.trim()
  }
  emit({ type: 'choose', message: 'Sign in to DeepSeek', options: METHODS })
  const method = await answer()
  if (!METHODS.some((option) => option.value === method)) throw new LoginError('Unknown choice')

  let key
  if (method === 'api-key') {
    emit({ type: 'input', message: 'DeepSeek API key', placeholder: 'sk-…', secret: true })
    key = await answer()
    if (!key) throw new LoginError('Empty answer')
  }
  const dsh = await start({ method })
  try {
    if (key) dsh.write(key)
    let frame = await dsh.frames.next()
    if (frame.type === 'browser') {
      const redirect = new URL(`http://127.0.0.1:${String(dsh.port)}/oauth/callback`)
      emit({ type: 'browser', url: frame.url, paste: 'address' })
      // DSH ending the attempt first (it expired) ends the sign-in rather than the paste.
      const next = dsh.frames.next()
      const pasted = await Promise.race([answer(), next.then(() => undefined)])
      if (pasted !== undefined) {
        const address = pastedAddress(pasted, redirect)
        if (!address) throw new LoginError('Not the sign-in address')
        await fetchImpl(address, { redirect: 'manual' }).catch(() => {})
      }
      frame = await next
    }
    if (frame.type !== 'done' || frame.phase !== 'succeeded')
      throw new LoginError('DSH did not sign in')
  } finally {
    dsh.stop()
  }
  await setDefaultProvider(dshHome, method === 'account')
  emit({ type: 'authenticated' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Provider output can contain sensitive values; report only a fixed reason.
  const fail = () => {
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exit(1)
  }
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, fail)
  process.stdout.on('error', fail)
  setTimeout(fail, 15 * 60_000).unref()
  try {
    const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
    await runDshLogin({ lines })
    process.exit(0)
  } catch {
    fail()
  }
}
