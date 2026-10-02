// Minimal ACP model-discovery client: initializes a session, reads the model,
// effort and fast-mode config options, optionally selects a model, and prints
// them as JSON. It never sends a prompt, so it needs no account.
//
// Usage: node test/model-discovery.mjs <codex|claude-code> [model]

import { spawn } from 'node:child_process'

const provider = process.argv[2]
const allowUnauthenticated = process.argv.includes('--allow-unauthenticated')
const requestedModel = process.argv.slice(3).find((arg) => arg !== '--allow-unauthenticated')
const cwd = process.env.ACP_DISCOVERY_CWD ?? '/workspace'

if (!['codex', 'claude-code'].includes(provider)) {
  process.stderr.write(`unknown provider: ${provider}\n`)
  process.exit(1)
}

const fail = (reason) => {
  process.stderr.write(`${reason}\n`)
  process.exit(1)
}

// The adapter gets an explicit allowlist, never the ambient environment: the
// transport auth key must not reach the agent process.
const AGENT_ENV = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
]

const child = spawn(provider === 'codex' ? 'codex-acp' : 'claude-agent-acp', [], {
  cwd,
  env: Object.fromEntries(
    AGENT_ENV.filter((key) => typeof process.env[key] === 'string').map((key) => [
      key,
      process.env[key],
    ]),
  ),
  stdio: ['pipe', 'pipe', 'inherit'],
})

child.on('error', (error) => fail(`adapter failed to start: ${error.message}`))
child.on('exit', (code) => fail(`adapter exited early with ${code}`))

const timer = setTimeout(() => fail('timed out waiting for the adapter'), 25_000)
const send = (id, method, params) =>
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)

const optionsOf = (configOptions, match) => {
  const option = configOptions.find(match)

  return Array.isArray(option?.options) ? option : undefined
}

const readControls = (configOptions, model) => {
  const effort = optionsOf(
    configOptions,
    (o) =>
      o.category === 'thought_level' || ['reasoning_effort', 'effort', 'thinking'].includes(o.id),
  )
  const fast = optionsOf(configOptions, (o) => ['fast-mode', 'fast_mode', 'fast'].includes(o.id))

  return {
    modelId: model.currentValue,
    effort: (effort?.options ?? []).map((o) => ({ value: o.value, name: o.name })),
    fast: ['on', 'off'].every((value) => fast?.options?.some((o) => o.value === value)),
    ...(fast?.currentValue === 'on' || fast?.currentValue === 'off'
      ? { defaultFast: fast.currentValue }
      : {}),
  }
}

const finish = (payload) => {
  clearTimeout(timer)
  child.removeAllListeners('exit')
  child.kill()
  process.stdout.write(JSON.stringify(payload), () => process.exit(0))
}

let models
let pending = ''

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  pending += chunk
  let newline

  while ((newline = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newline)

    pending = pending.slice(newline + 1)
    let frame

    try {
      frame = JSON.parse(line)
    } catch {
      continue
    }

    // Discovery answers nothing the adapter asks of it; a live client would.
    if (frame.method && frame.id !== undefined) {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: frame.id,
          error: { code: -32601, message: 'Unavailable during model discovery' },
        })}\n`,
      )
      continue
    }
    if (
      allowUnauthenticated &&
      provider === 'codex' &&
      frame.id === 2 &&
      frame.error?.code === -32000 &&
      frame.error?.message === 'Authentication required'
    ) {
      finish({ models: [], authenticationRequired: true })
      continue
    }
    if (frame.error) fail(`request ${frame.id} failed: ${JSON.stringify(frame.error)}`)
    if (frame.id === 1) {
      send(2, 'session/new', { cwd, mcpServers: [] })
      continue
    }
    if (frame.id !== 2 && frame.id !== 3) continue

    const configOptions = frame.result?.configOptions

    if (!Array.isArray(configOptions)) fail('the adapter advertised no configOptions')

    const model = optionsOf(configOptions, (o) => o.category === 'model' || o.id === 'model')

    if (!model) fail('the adapter advertised no model option')

    if (frame.id === 2) {
      models = model.options.map((o) => ({
        id: o.value,
        name: o.name,
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
      }))
      if (requestedModel && requestedModel !== model.currentValue) {
        if (!models.some((o) => o.id === requestedModel)) fail(`${requestedModel} is not offered`)
        send(3, 'session/set_config_option', {
          sessionId: frame.result.sessionId,
          configId: model.id,
          value: requestedModel,
        })
        continue
      }
    }
    if (requestedModel && model.currentValue !== requestedModel)
      fail(`the adapter kept ${model.currentValue} instead of ${requestedModel}`)
    finish({ models, controls: readControls(configOptions, model) })
  }
})

send(1, 'initialize', {
  protocolVersion: 1,
  clientCapabilities: {},
  clientInfo: { name: 'nuphos-runtime-model-discovery', version: '1' },
})
