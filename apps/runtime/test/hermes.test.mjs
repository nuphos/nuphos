import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'

import { agentEnv } from '../image/acp-shim.mjs'
import { runHermesLogin, signInPage } from '../image/hermes-login.mjs'
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
    if (args[0] === '-I') finish(JSON.stringify(PROVIDERS))
    else if (args[0] === 'config') finish('')
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

async function signIn(answers, hermes) {
  const frames = []
  const lines = (async function* () {
    for (const answer of answers) yield answer
  })()
  await runHermesLogin({ lines, emit: (frame) => frames.push(frame), run: hermes.run, settleMs: 0 })
  return frames
}

test('an API key reaches Hermes on stdin, never on its command line', async () => {
  const hermes = fakeHermes()
  const frames = await signIn(['lmstudio', 'sk-secret', 'qwen3-coder'], hermes)
  const add = hermes.calls.find((call) => call.args[0] === 'auth')
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
  const add = hermes.calls.find((call) => call.args[0] === 'auth')
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
