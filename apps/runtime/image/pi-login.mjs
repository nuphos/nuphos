// Run through OpenAB's operator-gated `_openab/runtime/login`, with the frames of
// opencode-login.mjs: `choose` and `input` wait for one line each.
//
// Pi signs in to a model provider with `pi auth login`, which only runs in a terminal. An
// API key needs none: it is the entry Pi documents for its auth.json, so this writes that
// entry, asks Pi whether the provider is ready, and makes one of the models Pi then lists
// the one every conversation starts on (pi-session.mjs). Signing in with an account in
// the browser waits for a Pi that can do it without a terminal.
//
// The same wrapper signs in Pi on a computer, which names its own CLI and home.
import { execFile } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

import { MODEL_SETTINGS, readJson, writeJson } from './pi-session.mjs'

const PI = process.env.NUPHOS_AGENT_EXECUTABLE || 'pi'
const HOME = process.env.NUPHOS_AGENT_HOME || process.env.HOME || '/home/node'
// More models than a list can offer: the model is typed instead.
const MAX_LISTED = 40

/** The providers Pi takes an API key for, by the id `pi auth` knows them by. */
export const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xai', label: 'xAI' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'fireworks', label: 'Fireworks' },
  { value: 'together', label: 'Together AI' },
  { value: 'moonshotai', label: 'Moonshot AI' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'zai', label: 'ZAI Coding Plan' },
  { value: 'kimi-coding', label: 'Kimi For Coding' },
  { value: 'vercel-ai-gateway', label: 'Vercel AI Gateway' },
  { value: 'opencode', label: 'OpenCode Zen' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
]

class LoginError extends Error {}

/** Runs a Pi command in the agent's home and resolves with what it printed. */
export function runPi(args, agentDir) {
  return new Promise((resolve, reject) => {
    execFile(
      PI,
      args,
      {
        // Not the gateway's environment: no transport keys or session tokens.
        env: {
          HOME,
          USERPROFILE: HOME,
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
          PI_CODING_AGENT_DIR: agentDir,
          // The model catalog Pi ships, without its startup update checks.
          PI_OFFLINE: '1',
          NO_COLOR: '1',
        },
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

  const provider = await choose('Choose a model provider', PROVIDERS)
  const { label } = PROVIDERS.find((entry) => entry.value === provider)
  const key = await input({ message: `${label} API key`, secret: true })
  const agentDir = join(home, '.pi', 'agent')
  const authFile = join(agentDir, 'auth.json')
  const before = readJson(authFile)
  mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  // In the file, never on a command line, where every process on the computer could read it.
  writeJson(authFile, { ...before, [provider]: { type: 'api_key', key } })
  try {
    const check = JSON.parse(
      await run(['auth', 'check', '--provider', provider, '--json'], agentDir),
    )
    if (check.status !== 'ready') throw new LoginError('Not ready')
    const models = listedModels(await run(['--list-models'], agentDir), provider)
    if (!models.length) throw new LoginError('No models')
    const model =
      models.length > MAX_LISTED
        ? await input({ message: `${label} model ID` })
        : models.length === 1
          ? models[0]
          : await choose(
              'Choose the model conversations start on',
              models.map((value) => ({ value, label: value })),
            )
    if (!models.includes(model)) throw new LoginError('Unknown model')
    const [defaultProvider, defaultModel] = MODEL_SETTINGS
    writeJson(join(agentDir, 'settings.json'), {
      ...readJson(join(agentDir, 'settings.json')),
      [defaultProvider]: provider,
      [defaultModel]: model,
    })
  } catch (error) {
    // A sign-in that did not finish leaves the login as it was: none, when there was none.
    if (Object.keys(before).length) writeJson(authFile, before)
    else rmSync(authFile, { force: true })
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
