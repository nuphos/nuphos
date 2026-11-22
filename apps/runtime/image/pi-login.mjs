// Run through OpenAB's operator-gated `_openab/runtime/login`, with the frames of
// opencode-login.mjs: `choose` and `input` wait for one line each.
//
// Pi signs in to a model provider with `pi auth login`, which only runs in a terminal. An
// API key needs none: it is the entry Pi documents for its auth.json, so this writes that
// entry, asks Pi whether the provider is ready, and starts every conversation on Pi's
// default model for that provider (pi-session.mjs), as Pi's own login does: a conversation's
// model menu changes it. Without it, Pi starts on the first provider in its own order that has
// any credential on the computer, not the one just signed in to. An account is Pi's own
// `pi auth login <provider> --no-browser`, run in a terminal of its own (`script`), whose
// sign-in page and code become a `browser` step: the user opens it wherever they are.
//
// The same wrapper signs in Pi on a computer, which names its own CLI and home.
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

import { MODEL_SETTINGS, readJson, writeJson } from './pi-session.mjs'

const PI = process.env.NUPHOS_AGENT_EXECUTABLE || 'pi'
const HOME = process.env.NUPHOS_AGENT_HOME || process.env.HOME || '/home/node'

/**
 * The providers Pi takes an API key for, by the id `pi auth` knows them by, with the model
 * Pi starts each on (its defaultModelPerProvider, which it does not export).
 */
const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic', model: 'claude-opus-5-5' },
  { value: 'openai', label: 'OpenAI', model: 'gpt-6.1-sol' },
  { value: 'google', label: 'Google Gemini', model: 'gemini-4-argon' },
  { value: 'openrouter', label: 'OpenRouter', model: 'moonshotai/kimi-k2.7-code' },
  { value: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-pro' },
  { value: 'xai', label: 'xAI', model: 'grok-4.7' },
  { value: 'mistral', label: 'Mistral', model: 'devstral-medium-latest' },
  { value: 'groq', label: 'Groq', model: 'openai/gpt-oss-120b' },
  { value: 'cerebras', label: 'Cerebras', model: 'gpt-oss-120b' },
  { value: 'fireworks', label: 'Fireworks', model: 'accounts/fireworks/models/kimi-k3' },
  { value: 'together', label: 'Together AI', model: 'moonshotai/Kimi-K3' },
  { value: 'moonshotai', label: 'Moonshot AI', model: 'kimi-k2.7-code' },
  { value: 'minimax', label: 'MiniMax', model: 'MiniMax-M3' },
  { value: 'zai', label: 'ZAI Coding Plan', model: 'glm-5.3' },
  { value: 'kimi-coding', label: 'Kimi For Coding', model: 'kimi-for-coding' },
  { value: 'vercel-ai-gateway', label: 'Vercel AI Gateway', model: 'zai/glm-5.3' },
  { value: 'opencode', label: 'OpenCode Zen', model: 'kimi-k2.7-code' },
  { value: 'huggingface', label: 'Hugging Face', model: 'moonshotai/Kimi-K2.7-Code' },
  { value: 'nvidia', label: 'NVIDIA NIM', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b' },
  // An endpoint of the user's own (a gateway, a proxy, a local model server): a provider
  // Pi's models.json adds, with its key in auth.json like every other provider's. Its id is
  // one a user is unlikely to have written there themselves, so their own `custom` stays.
  { value: 'nuphos-custom', label: 'Custom (OpenAI-compatible)' },
]

/**
 * The accounts Pi signs in to without a browser on this computer: a page to open and a code
 * to paste back, or a device code. Windows has no `script` to give Pi its terminal.
 */
const ACCOUNTS =
  process.platform === 'win32'
    ? []
    : [
        {
          value: 'anthropic-account',
          provider: 'anthropic',
          label: 'Claude Pro/Max account',
          model: 'claude-opus-5-5',
        },
        { value: 'openai-codex', label: 'ChatGPT Plus/Pro (Codex)', model: 'gpt-6.1-sol' },
        { value: 'github-copilot', label: 'GitHub Copilot', model: 'gpt-6.1-sol' },
      ]

// The computer itself: a key sent there over plain http never crosses the network.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

class LoginError extends Error {}

const restore = (file, before) =>
  Object.keys(before).length ? writeJson(file, before) : rmSync(file, { force: true })

// Not the gateway's environment: no transport keys or session tokens.
const piEnv = (agentDir) => ({
  HOME,
  USERPROFILE: HOME,
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  PI_CODING_AGENT_DIR: agentDir,
  // The model catalog Pi ships, without its startup update checks.
  PI_OFFLINE: '1',
  NO_COLOR: '1',
})

/** Runs a Pi command in the agent's home and resolves with what it printed. */
export function runPi(args, agentDir) {
  return new Promise((resolve, reject) => {
    execFile(
      PI,
      args,
      {
        env: piEnv(agentDir),
        timeout: 60_000,
        windowsHide: true,
        shell: PI.endsWith('.cmd'),
      },
      (error, stdout) => (error ? reject(new LoginError('pi failed')) : resolve(stdout)),
    )
  })
}

/** The model ids `pi --list-models` prints for one provider: `provider  model  context ...`. */
export function listedModels(output, provider) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([name, model]) => name === provider && model)
    .map(([, model]) => model)
}

/**
 * Pi's own account sign-in, in the terminal `script` gives it (util-linux, or BSD on macOS).
 * The page it prints becomes a `browser` step, which waits for the code when Pi asks for one.
 */
export async function piAccountLogin(provider, agentDir, { emit, answer }) {
  const command = [PI, 'auth', 'login', provider, '--no-browser']
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
  const child = spawn(
    'script',
    process.platform === 'darwin'
      ? ['-q', '/dev/null', ...command]
      : ['-qfec', command.map(quote).join(' '), '/dev/null'],
    { env: { ...piEnv(agentDir), TERM: 'dumb' }, stdio: ['pipe', 'pipe', 'ignore'] },
  )
  const stop = () => child.kill('SIGKILL')
  process.once('exit', stop)
  child.stdin.on('error', stop)
  const exited = new Promise((resolve) => {
    child.once('error', () => resolve(1))
    child.once('close', resolve)
  })
  let output = ''
  let domain = false
  let shown = false
  child.stdout.on('data', (chunk) => {
    output = (output + stripVTControlCharacters(chunk.toString())).slice(-65_536)
    // GitHub Copilot first asks for an Enterprise domain; none is github.com.
    if (!domain && output.includes('Enterprise URL/domain')) {
      domain = true
      child.stdin.write('\r')
    }
    if (shown) return
    const page = /Open this URL to sign in:\s+(https:\/\/\S+)\s/u.exec(output)
    const device = /Open (https:\/\/\S+) and enter code: ([A-Za-z0-9-]+)\s/u.exec(output)
    if (page) {
      shown = true
      emit({ type: 'browser', url: page[1], paste: 'code' })
      // A terminal submits on carriage return. No answer ends the sign-in.
      answer().then((code) => child.stdin.write(`${code}\r`), stop)
    } else if (device) {
      shown = true
      emit({ type: 'browser', url: device[1], instructions: `Enter the code ${device[2]}` })
    }
  })
  const code = await exited
  process.off('exit', stop)
  if (code !== 0) throw new LoginError('Account sign-in failed')
}

export async function runPiLogin({
  lines,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  home = HOME,
  run = runPi,
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

  const choice = await choose(
    'Choose a model provider',
    [...ACCOUNTS, ...PROVIDERS].map(({ value, label }) => ({ value, label })),
  )
  const account = ACCOUNTS.find((entry) => entry.value === choice)
  const {
    label,
    model,
    provider = choice,
  } = account ?? PROVIDERS.find((entry) => entry.value === choice)
  const endpoint = provider === 'nuphos-custom' && {
    baseUrl: await input({ message: 'Base URL', placeholder: 'http://localhost:11434/v1' }),
  }
  if (endpoint && !/^https?:\/\/./u.test(endpoint.baseUrl)) throw new LoginError('Not a URL')
  const preferred = endpoint ? await input({ message: 'Model ID' }) : model
  const key =
    !account &&
    (await input({
      message: !endpoint
        ? `${label} API key`
        : endpoint.baseUrl.startsWith('http:') && !LOOPBACK.has(new URL(endpoint.baseUrl).hostname)
          ? 'API key (sent unencrypted over http)'
          : 'API key',
      ...(endpoint ? { placeholder: 'Any text if the endpoint takes none' } : {}),
      secret: true,
    }))
  const agentDir = join(home, '.pi', 'agent')
  const authFile = join(agentDir, 'auth.json')
  const modelsFile = join(agentDir, 'models.json')
  const before = readJson(authFile)
  const beforeModels = readJson(modelsFile)
  mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  // In the file, never on a command line, where every process on the computer could read it.
  if (key) writeJson(authFile, { ...before, [provider]: { type: 'api_key', key } })
  if (endpoint)
    writeJson(modelsFile, {
      ...beforeModels,
      providers: {
        ...beforeModels.providers,
        [provider]: {
          name: 'Custom',
          ...endpoint,
          api: 'openai-completions',
          models: [{ id: preferred }],
        },
      },
    })
  try {
    if (account) await piAccountLogin(provider, agentDir, { emit, answer })
    const check = JSON.parse(
      await run(['auth', 'check', '--provider', provider, '--json'], agentDir),
    )
    if (check.status !== 'ready') throw new LoginError('Not ready')
    const models = listedModels(await run(['--list-models'], agentDir), provider)
    if (!models.length) throw new LoginError('No models')
    // A Pi whose default has since changed starts where its list does.
    const chosen = models.includes(preferred) ? preferred : models[0]
    const [defaultProvider, defaultModel] = MODEL_SETTINGS
    writeJson(join(agentDir, 'settings.json'), {
      ...readJson(join(agentDir, 'settings.json')),
      [defaultProvider]: provider,
      [defaultModel]: chosen,
    })
  } catch (error) {
    // A sign-in that did not finish leaves the login as it was: none, when there was none.
    restore(authFile, before)
    if (endpoint) restore(modelsFile, beforeModels)
    throw error
  }
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
    await runPiLogin({
      lines: createInterface({ input: process.stdin })[Symbol.asyncIterator](),
    })
    process.exit(0)
  } catch {
    fail()
  }
}
