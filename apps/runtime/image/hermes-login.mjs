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
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const HERMES = 'hermes'
const PYTHON = '/opt/hermes/.venv/bin/python'
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
// What `hermes auth add` signs in to, from Hermes itself. OpenRouter is Hermes's default
// rather than a registry entry. Qwen OAuth only copies a Qwen CLI login from the same
// computer, and providers with an id of their own share a name with the first one.
const CATALOG = `
import json
from hermes_cli.auth import PROVIDER_REGISTRY
from hermes_cli.auth_commands import _OAUTH_ADD_SPECS
from hermes_cli.models import get_default_model_for_provider as model
out = [{"id": "openrouter", "name": "OpenRouter", "key": True, "oauth": True, "model": model("openrouter")}]
names = {"OpenRouter"}
for id, provider in PROVIDER_REGISTRY.items():
    oauth = id == "nous" or (id in _OAUTH_ADD_SPECS and id != "qwen-oauth")
    if provider.name in names or not (oauth or provider.auth_type == "api_key"):
        continue
    names.add(provider.name)
    out.append({"id": id, "name": provider.name, "key": provider.auth_type == "api_key",
                "oauth": oauth, "model": model(id)})
print(json.dumps(out))
`

class LoginError extends Error {}

// Not the gateway's environment: no transport keys or session tokens.
const hermesEnv = (extra = {}) => ({
  HOME: process.env.HOME ?? '/home/node',
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HERMES_DISABLE_LAZY_INSTALLS: '1',
  NO_COLOR: '1',
  TERM: 'dumb',
  ...extra,
})

/**
 * Runs a Hermes command. `detached` starts it without a terminal, so the prompts that
 * would read one read stdin; `kill` reaches the whole group it starts.
 */
export function runHermes(command, args, { env = hermesEnv(), onOutput } = {}) {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  const kill = () => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
  process.once('exit', kill)
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
    onOutput?.(output)
  })
  child.stderr.resume()
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      process.off('exit', kill)
      if (code === 0) resolve(output)
      else reject(new LoginError(`${command} ${args[0]} failed`))
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

  const providers = JSON.parse(await run(PYTHON, ['-I', '-c', CATALOG]).done)
  const id = await choose('Choose a model provider', providerOptions(providers))
  const provider = providers.find((entry) => entry.id === id)
  const methods = [
    ...(provider.oauth
      ? [{ value: 'oauth', label: 'Sign in with a browser', ...SUBSCRIPTION[id] }]
      : []),
    ...(provider.key ? [{ value: 'api-key', label: 'API key' }] : []),
  ]
  const method =
    methods.length === 1 ? methods[0].value : await choose(`Sign in to ${provider.name}`, methods)

  if (method === 'api-key') {
    const key = await input({ message: `${provider.name} API key`, secret: true })
    // On stdin, not the command line, where every process in the container could read it.
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
  const fail = () => {
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exit(1)
  }
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, fail)
  process.stdout.on('error', fail)
  setTimeout(fail, 15 * 60_000).unref()
  try {
    await runHermesLogin({
      lines: createInterface({ input: process.stdin })[Symbol.asyncIterator](),
    })
    process.exit(0)
  } catch {
    fail()
  }
}
