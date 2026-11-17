// Run through OpenAB's operator-gated `_openab/runtime/login`, with the frames of
// opencode-login.mjs: `choose` and `input` wait for one line each, `browser` {url,
// instructions, paste?} for the pasted code when `paste` is set, and otherwise for
// Hermes to see the approval itself.
//
// Hermes signs in to each of its providers with `hermes auth add`: an API key, a device
// page, or a browser page that shows a code to paste back. This drives that command, so
// Hermes writes the credential to ~/.hermes/auth.json itself and no frame carries it.
// The provider and a model then become the root config's model, which every
// conversation's profile copies (hermes-session.mjs).
//
// The same wrapper signs in Hermes on a computer, which names its own CLI and home.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const HERMES = process.env.NUPHOS_AGENT_EXECUTABLE || 'hermes'
const HOME = process.env.NUPHOS_AGENT_HOME || process.env.HOME || '/home/node'
const WINDOWS = process.platform === 'win32'
// What Python on Windows needs to start, find its temp folder and run commands.
const WINDOWS_ENV = ['SYSTEMROOT', 'TEMP', 'TMP', 'PATHEXT', 'LOCALAPPDATA', 'APPDATA']
// Listed first; every other provider follows by name.
const FEATURED = ['nous', 'openai-codex', 'anthropic', 'openrouter', 'openai-api', 'gemini']
// Sign-ins whose page shows a code to paste back; the others are device pages.
const PASTE = new Set(['anthropic', 'openrouter'])
const SUBSCRIPTION = {
  anthropic: {
    label: 'Claude subscription',
    hint: 'Needs a Claude Max plan with extra usage turned on',
  },
}
// What `hermes auth add` signs in to, written by hermes-providers.py from the pinned Hermes.
const CATALOG = new URL('./hermes-providers.json', import.meta.url)

class LoginError extends Error {
  constructor(message, reason = 'failed') {
    super(message)
    this.reason = reason
  }
}

// What Hermes says when it cannot prepare its dependencies for this home.
const UNPREPARED = 'no dependency environment is committed'

// Not the gateway's environment: no transport keys or session tokens.
const hermesEnv = (extra = {}) => ({
  HOME,
  // Windows finds the home here, not in HOME.
  USERPROFILE: HOME,
  HERMES_HOME: join(HOME, '.hermes'),
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  ...Object.fromEntries(
    WINDOWS_ENV.filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
  ),
  // The image bakes in Hermes' dependencies and refuses more; a computer's Hermes
  // prepares them for each new home, so only the image's own environment refuses.
  ...(process.env.HERMES_DISABLE_LAZY_INSTALLS
    ? { HERMES_DISABLE_LAZY_INSTALLS: process.env.HERMES_DISABLE_LAZY_INSTALLS }
    : {}),
  NO_COLOR: '1',
  TERM: 'dumb',
  ...extra,
})

/**
 * Runs a Hermes command. `detached` starts it without a terminal, so the prompts that
 * would read one read stdin; `kill` reaches the whole group it starts. Windows has no
 * process groups, and a detached child there gets a console window of its own.
 */
export function runHermes(command, args, { env = hermesEnv(), onOutput } = {}) {
  const child = spawn(command, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: !WINDOWS,
    windowsHide: true,
  })
  const kill = () => {
    try {
      if (WINDOWS) child.kill()
      else process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
  process.once('exit', kill)
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
    onOutput?.(output)
  })
  let errors = ''
  child.stderr.on('data', (chunk) => {
    errors += chunk.toString()
  })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      process.off('exit', kill)
      if (code === 0) resolve(output)
      else
        reject(
          new LoginError(
            `${command} ${args[0]} failed`,
            `${output}${errors}`.includes(UNPREPARED) ? 'environment' : 'failed',
          ),
        )
    })
  })
  return { write: (text) => child.stdin.write(text), end: () => child.stdin.end(), done }
}

export function providerOptions(providers) {
  const rank = (id) => (FEATURED.includes(id) ? FEATURED.indexOf(id) : FEATURED.length)
  return [...providers]
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ value: id, label: name }))
}

/**
 * The page a sign-in prints, and a device page's code. The last address is the one to
 * open: Nous names its portal before the device page.
 */
export function signInPage(output) {
  const text = output.replace(/\u001b\[[0-9;]*m/gu, '')
  const url = text.match(/https:\/\/\S+/gu)?.at(-1)
  const code = /code:\s*([A-Z0-9-]{4,})/u.exec(text)?.[1]
  return url ? { url, ...(code ? { instructions: `Enter code: ${code}` } : {}) } : undefined
}

export async function runHermesLogin({
  lines,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  run = runHermes,
  settleMs = 500,
  providers = JSON.parse(readFileSync(CATALOG, 'utf8')),
  windows = WINDOWS,
}) {
  const answer = async () => {
    const { value, done } = await lines.next()
    if (done) throw new LoginError('No answer')
    return value.trim()
  }
  const choose = async (message, options) => {
    emit({ type: 'choose', message, options })
    const value = await answer()
    if (!options.some((option) => option.value === value)) throw new LoginError('Unknown choice')
    return value
  }
  const input = async (frame) => {
    emit({ type: 'input', ...frame })
    const value = await answer()
    if (!value) throw new LoginError('Empty answer')
    return value
  }

  // Hermes asks for an API key, and for OpenRouter's code, with a hidden prompt, which on
  // Windows reads the console and never stdin; those sign-ins wait for a later Hermes there.
  const methodsOf = ({ id, oauth, key }) =>
    [
      ...(oauth ? [{ value: 'oauth', label: 'Sign in with a browser', ...SUBSCRIPTION[id] }] : []),
      ...(key ? [{ value: 'api-key', label: 'API key' }] : []),
    ].filter(({ value }) => !windows || !(value === 'api-key' || id === 'openrouter'))
  const offered = providers.filter((entry) => methodsOf(entry).length)
  const id = await choose(
    windows
      ? 'Choose a model provider. API keys cannot be added on Windows yet.'
      : 'Choose a model provider',
    providerOptions(offered),
  )
  const provider = offered.find((entry) => entry.id === id)
  const methods = methodsOf(provider)
  const method =
    methods.length === 1 ? methods[0].value : await choose(`Sign in to ${provider.name}`, methods)

  if (method === 'api-key') {
    const key = await input({ message: `${provider.name} API key`, secret: true })
    // On stdin, never the command line, where every process on the computer could read it.
    const add = run(HERMES, ['auth', 'add', id, '--type', 'api-key'])
    add.write(`${key}\n`)
    add.end()
    await add.done
  } else {
    let shown
    let settle
    const page = new Promise((resolve) => {
      shown = resolve
    })
    const add = run(HERMES, ['auth', 'add', id, '--type', 'oauth', '--no-browser'], {
      // OpenRouter shows a code to paste, rather than calling back a listener here.
      env: hermesEnv(id === 'openrouter' ? { SSH_CLIENT: 'nuphos' } : {}),
      // Once the page is printed and the output has settled, it includes the code to enter.
      onOutput: (output) => {
        clearTimeout(settle)
        const found = signInPage(output)
        if (found) settle = setTimeout(() => shown(found), settleMs)
      },
    })
    const found = await Promise.race([page, add.done.then(() => undefined)])
    if (!found) throw new LoginError('No sign-in page')
    emit({ type: 'browser', ...found, ...(PASTE.has(id) ? { paste: 'code' } : {}) })
    if (PASTE.has(id)) {
      const ended = add.done.then(() => {
        throw new LoginError('Sign-in ended before the code')
      })
      add.write(`${await Promise.race([answer(), ended])}\n`)
    }
    await add.done
  }

  const model = provider.model || (await input({ message: `${provider.name} model ID` }))
  for (const [key, value] of [
    ['model.provider', id],
    ['model.default', model],
  ])
    // After `--`, a model ID that starts with `-` stays a value.
    await run(HERMES, ['config', 'set', '--', key, value]).done
  emit({ type: 'authenticated' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Provider output can contain sensitive values; report only a fixed reason.
  const fail = (reason = 'failed') => {
    process.stdout.write(`${JSON.stringify({ type: 'error', reason })}\n`)
    process.exit(1)
  }
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => fail())
  process.stdout.on('error', () => fail())
  setTimeout(fail, 15 * 60_000).unref()
  try {
    await runHermesLogin({
      lines: createInterface({ input: process.stdin })[Symbol.asyncIterator](),
    })
    process.exit(0)
  } catch (error) {
    fail(error instanceof LoginError ? error.reason : undefined)
  }
}
