import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { agentEnv } from '../image/acp-shim.mjs'
import { runHermes, runHermesLogin, signInPage } from '../image/hermes-login.mjs'
import { hermesProfile, modelBlock } from '../image/hermes-session.mjs'

const ROOT_CONFIG =
  'agent:\n  max_turns: 9\nmodel:\n  provider: nous\n  default: z-ai/glm-5.3\nupdates:\n  check: true\n'

test('the sign-in model is the only part of the root config a profile copies', () => {
  assert.equal(modelBlock(ROOT_CONFIG), 'model:\n  provider: nous\n  default: z-ai/glm-5.3')
  assert.equal(modelBlock('agent:\n  max_turns: 9\n'), '')
})

test('each conversation and each teammate in it runs Hermes from a profile of its own', () => {
  const home = mkdtempSync(join(tmpdir(), 'hermes-runtime-'))
  try {
    mkdirSync(join(home, '.hermes'))
    writeFileSync(join(home, '.hermes', 'config.yaml'), ROOT_CONFIG)
    const env = (session) => agentEnv('hermes', { env: session }, { HOME: home, PATH: '/bin' })
    const owner = env({ NUPHOS_SESSION_ID: 'conversation-a', NUPHOS_TOKEN: 'a' })
    const again = env({ NUPHOS_SESSION_ID: 'conversation-a', NUPHOS_TOKEN: 'a' })
    const other = env({ NUPHOS_SESSION_ID: 'conversation-b', NUPHOS_TOKEN: 'b' })
    const teammate = env({
      NUPHOS_SESSION_ID: 'conversation-a',
      NUPHOS_SESSION_ACTOR: 'teammate',
      NUPHOS_TOKEN: 't',
    })
    // A profile per session home, under the root that holds the login.
    assert.equal(owner.HERMES_HOME, again.HERMES_HOME)
    assert.equal(new Set([owner, other, teammate].map((e) => e.HERMES_HOME)).size, 3)
    for (const { HERMES_HOME } of [owner, other, teammate]) {
      assert.equal(dirname(HERMES_HOME), join(home, '.hermes', 'profiles'))
      assert.match(basename(HERMES_HOME), /^[a-f0-9]{64}$/u)
    }
    const config = readFileSync(join(owner.HERMES_HOME, 'config.yaml'), 'utf8')
    assert.ok(config.startsWith('model:\n  provider: nous\n  default: z-ai/glm-5.3\n'))
    assert.match(config, /^ {2}standalone: true$/mu)
    assert.match(config, /^ {2}memory_enabled: false$/mu)
    assert.match(config, /^ {2}allow_lazy_installs: false$/mu)
    assert.doesNotMatch(config, /max_turns|check: true/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a profile still starts before anyone has signed in', () => {
  const home = mkdtempSync(join(tmpdir(), 'hermes-runtime-'))
  try {
    const profile = hermesProfile(home, home, '/workspace')
    const config = readFileSync(join(profile, 'config.yaml'), 'utf8')
    assert.ok(config.startsWith('gateway:\n'))
    assert.match(config, /external_dirs: \["\/workspace\/\.agents\/skills"\]/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', key: true, oauth: true, model: 'z-ai/glm-5.3' },
  { id: 'anthropic', name: 'Anthropic', key: true, oauth: true, model: 'claude-x' },
  { id: 'nous', name: 'Nous Portal', key: false, oauth: true, model: 'z-ai/glm-5.3' },
  { id: 'lmstudio', name: 'LM Studio', key: true, oauth: false, model: '' },
]

/** A Hermes that answers each command the way the real one does, and records them. */
function fakeHermes(output = {}) {
  const calls = []
  const run = (command, args, options = {}) => {
    const call = { command, args, stdin: '', env: options.env }
    calls.push(call)
    let finish
    const done = new Promise((resolve) => {
      finish = resolve
    })
    if (args[0] === 'config' || args[1] === 'list') finish('')
    else if (args[3] === 'api-key') {
      /* finishes once the key arrives */
    } else
      setImmediate(() => {
        options.onOutput?.(output[args[2]])
        // A device page stays up until the approval, well after the page settles.
        if (!output.paste) setTimeout(() => finish(''), 20)
      })
    return {
      write: (text) => {
        call.stdin += text
        finish('')
      },
      end: () => {},
      done,
    }
  }
  return { calls, run }
}

async function signIn(answers, hermes, windows = false, prepare = true) {
  const frames = []
  const lines = (async function* () {
    for (const answer of answers) yield answer
  })()
  await runHermesLogin({
    lines,
    emit: (frame) => frames.push(frame),
    run: hermes.run,
    settleMs: 0,
    providers: PROVIDERS,
    windows,
    prepare,
  })
  return frames
}

test("a computer's Hermes prepares its home while the user answers, and signs in after", async () => {
  const hermes = fakeHermes()
  const run = hermes.run
  let prepared
  // `hermes auth list` prepares a new home's dependencies first: here, until released.
  hermes.run = (command, args, options) => {
    if (args[1] !== 'list') return run(command, args, options)
    hermes.calls.push({ command, args })
    return { write() {}, end() {}, done: new Promise((resolve) => (prepared = resolve)) }
  }
  const frames = []
  const answers = ['openrouter', 'api-key', 'sk-secret']
  const login = runHermesLogin({
    lines: (async function* () {
      yield* answers
    })(),
    emit: (frame) => frames.push(frame),
    run: hermes.run,
    settleMs: 0,
    providers: PROVIDERS,
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  // Started before the first question, which says so; the key waits for it to finish.
  assert.deepEqual(hermes.calls[0].args, ['auth', 'list'])
  assert.equal(
    frames[0].message,
    'Choose a model provider. Hermes gets ready meanwhile, which can take a minute the first time',
  )
  assert.equal(frames.at(-1).type, 'input')
  assert.equal(
    hermes.calls.find((call) => call.args[1] === 'add'),
    undefined,
  )
  prepared('')
  await login
  assert.deepEqual(frames.at(-1), { type: 'authenticated' })
  assert.equal(hermes.calls.find((call) => call.args[1] === 'add').stdin, 'sk-secret\n')
})

test('the image, whose Hermes is prepared already, asks at once and prepares nothing', async () => {
  const hermes = fakeHermes()
  const frames = await signIn(['openrouter', 'api-key', 'sk-secret'], hermes, false, false)
  assert.equal(frames[0].message, 'Choose a model provider')
  assert.ok(hermes.calls.every((call) => call.args[1] !== 'list'))
})

test('an API key reaches Hermes on stdin, never on its command line', async () => {
  const hermes = fakeHermes()
  const frames = await signIn(['lmstudio', 'sk-secret', 'qwen3-coder'], hermes)
  const add = hermes.calls.find((call) => call.args[1] === 'add')
  assert.deepEqual(add.args, ['auth', 'add', 'lmstudio', '--type', 'api-key'])
  assert.equal(add.stdin, 'sk-secret\n')
  assert.ok(hermes.calls.every((call) => !call.args.includes('sk-secret')))
  // No default model for this provider, so one is asked for.
  assert.deepEqual(frames.at(-2), { type: 'input', message: 'LM Studio model ID' })
  assert.deepEqual(
    hermes.calls.filter((call) => call.args[0] === 'config').map((call) => call.args.slice(3)),
    [
      ['model.provider', 'lmstudio'],
      ['model.default', 'qwen3-coder'],
    ],
  )
  assert.deepEqual(frames.at(-1), { type: 'authenticated' })
})

test('a Claude subscription says what it needs, and its code is pasted back', async () => {
  const hermes = fakeHermes({
    paste: true,
    anthropic: 'Open this link:\n  https://claude.ai/oauth/authorize?x=1\n\nAuthorization code: ',
  })
  const frames = await signIn(['anthropic', 'oauth', 'pasted-code'], hermes)
  assert.deepEqual(frames[1].options[0], {
    value: 'oauth',
    label: 'Claude subscription',
    hint: 'Needs a Claude Max plan with extra usage turned on',
  })
  assert.deepEqual(frames[2], {
    type: 'browser',
    url: 'https://claude.ai/oauth/authorize?x=1',
    paste: 'code',
  })
  const add = hermes.calls.find((call) => call.args[1] === 'add')
  assert.deepEqual(add.args, ['auth', 'add', 'anthropic', '--type', 'oauth', '--no-browser'])
  assert.equal(add.stdin, 'pasted-code\n')
  assert.deepEqual(frames.at(-1), { type: 'authenticated' })
})

test('a device page shows its code and Hermes waits for the approval itself', async () => {
  const hermes = fakeHermes({
    nous: 'Portal: https://portal.nousresearch.com\n\nTo continue:\n  1. Open: https://portal.nousresearch.com/manage-subscription?user_code=QY8H-7RFM\n  2. If prompted, enter code: QY8H-7RFM\nWaiting for approval...',
  })
  // Nous has no API key, so there is no method to choose.
  const frames = await signIn(['nous'], hermes)
  assert.deepEqual(frames[1], {
    type: 'browser',
    url: 'https://portal.nousresearch.com/manage-subscription?user_code=QY8H-7RFM',
    instructions: 'Enter code: QY8H-7RFM',
  })
  assert.deepEqual(frames.at(-1), { type: 'authenticated' })
})

test('Codex prints its code on the line after the prompt, in color', () => {
  assert.deepEqual(
    signInPage(
      '  1. Open this URL in your browser:\n     \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n  2. Enter this code:\n     \u001b[94mGCRU-S2PVN\u001b[0m\n',
    ),
    { url: 'https://auth.openai.com/codex/device', instructions: 'Enter code: GCRU-S2PVN' },
  )
})

test('the shipped provider list has what the sign-in features and offers', () => {
  const providers = JSON.parse(
    readFileSync(new URL('../image/hermes-providers.json', import.meta.url), 'utf8'),
  )
  const ids = providers.map((provider) => provider.id)
  for (const id of ['nous', 'openai-codex', 'anthropic', 'openrouter'])
    assert.ok(ids.includes(id), id)
  assert.ok(!ids.includes('qwen-oauth'))
  assert.equal(new Set(providers.map((provider) => provider.name)).size, providers.length)
})

test('on Windows, only sign-ins that never use the hidden prompt are offered', async () => {
  const hermes = fakeHermes({
    paste: true,
    anthropic: 'Open this link:\n  https://claude.ai/oauth/authorize?x=1\n\nAuthorization code: ',
  })
  const frames = await signIn(['anthropic', 'pasted-code'], hermes, true)
  // No API key anywhere, and OpenRouter's code goes through the hidden prompt too.
  assert.deepEqual(
    frames[0].options.map((option) => option.value),
    ['nous', 'anthropic'],
  )
  assert.match(frames[0].message, /API keys cannot be added on Windows yet/u)
  // A Claude subscription is the only method left, so there is nothing to choose.
  assert.equal(frames[1].type, 'browser')
  assert.ok(hermes.calls.every((call) => !call.args.includes('api-key')))
  assert.deepEqual(frames.at(-1), { type: 'authenticated' })
})

/**
 * Signs in to DeepSeek by running the wrapper as a computer does: openab hands it the
 * CLI and a fresh home (shimEnv), and the CLI here is a stub. Like a Hermes from the
 * official installer, it refuses `auth add` until it may prepare the new home's
 * dependencies; `broken` never can, as when the package index is unreachable.
 */
function signInOnComputer({ env = {}, broken = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hermes-computer-'))
  const home = join(root, 'hermes-home')
  mkdirSync(home)
  const cli = join(root, 'hermes')
  writeFileSync(
    cli,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  auth)',
      `    if ${broken ? 'true' : '[ -n "$HERMES_DISABLE_LAZY_INSTALLS" ]'}; then`,
      '      echo "error: no dependency environment is committed for this install; run hermes pm repair" >&2',
      '      exit 1',
      '    fi',
      '    read -r key',
      '    mkdir -p "$HERMES_HOME" && printf \'{"%s":"%s"}\' "$3" "$key" > "$HERMES_HOME/auth.json" ;;',
      '  config) printf \'%s: %s\\n\' "$4" "$5" >> "$HERMES_HOME/config.yaml" ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../image/hermes-login.mjs', import.meta.url))],
    {
      input: 'deepseek\nsk-test\n',
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NUPHOS_AGENT_EXECUTABLE: cli,
        NUPHOS_AGENT_HOME: home,
        ...env,
      },
    },
  )
  const frames = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const read = (file) => {
    try {
      return readFileSync(join(home, '.hermes', file), 'utf8')
    } catch {
      return undefined
    }
  }
  const signedIn = { frames, auth: read('auth.json'), config: read('config.yaml') }
  rmSync(root, { recursive: true, force: true })
  return signedIn
}

test("a computer's Hermes prepares a fresh home and signs in", () => {
  const { frames, auth, config } = signInOnComputer()
  assert.deepEqual(frames.at(-1), { type: 'authenticated' })
  assert.equal(auth, '{"deepseek":"sk-test"}')
  assert.equal(config, 'model.provider: deepseek\nmodel.default: deepseek-flash\n')
})

test('the image still refuses on-demand installs when its environment says so', () => {
  const { frames, auth } = signInOnComputer({ env: { HERMES_DISABLE_LAZY_INSTALLS: '1' } })
  assert.equal(frames.at(-1).type, 'error')
  assert.equal(auth, undefined)
})

test('a home Hermes cannot prepare is reported as that, not as a wrong answer', () => {
  const { frames } = signInOnComputer({ broken: true })
  assert.deepEqual(frames.at(-1), { type: 'error', reason: 'environment' })
})

test('a Hermes that stops reading before the key is reported, not lost in the pipe', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-computer-'))
  try {
    const cli = join(root, 'hermes')
    // Refuses, closes its stdin, and lives on a moment, so the key meets a closed pipe.
    writeFileSync(
      cli,
      [
        '#!/bin/sh',
        'exec 0<&-',
        'echo "error: no dependency environment is committed for this install"',
        'sleep 0.3',
        'exit 1',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
    let refused
    const said = new Promise((resolve) => {
      refused = resolve
    })
    const add = runHermes(cli, ['auth', 'add', 'deepseek', '--type', 'api-key'], {
      onOutput: refused,
    })
    await said
    add.write('sk-test\n')
    add.end()
    await assert.rejects(add.done, { reason: 'environment' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
