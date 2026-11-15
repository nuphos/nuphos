// Deterministic model substitute, behind the real OpenAB executable and ACP transport.
// No network tools, GitHub credentials, or real inference are used.
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
// Every entry names the agent host it ran on, which is what tells two runtimes apart.
const log = (entry) =>
  appendFileSync(
    process.env.E2E_ACP_LOG,
    `${JSON.stringify({ agent: process.env.E2E_AGENT, ...entry })}\n`,
  )
// A prompt containing E2E_HOLD stays in its turn until the client cancels it.
const held = new Map()
// The Nuphos tools server each session was given, when the backend offers one.
const tools = new Map()
// Each session's model settings, as a real agent reports and changes them.
const settings = new Map()
const choice = (value) => ({ value, name: value })
const newSettings = () => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'fixture',
    options: [choice('fixture')],
  },
  {
    id: 'fast',
    name: 'Fast',
    type: 'select',
    currentValue: 'off',
    options: [choice('off'), choice('on')],
  },
]

function applySetting(sessionId, id, value) {
  const list = settings.get(sessionId) ?? newSettings()
  const option = list.find((candidate) => candidate.id === id)

  if (option?.options.some((candidate) => candidate.value === value)) option.currentValue = value
  settings.set(sessionId, list)

  return list
}

/** One JSON-RPC call to a streamable-HTTP MCP server; the reply is JSON or a one-event stream. */
async function mcp(server, sessionHeader, method, params) {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: {
      ...Object.fromEntries(server.headers.map(({ name, value }) => [name, value])),
      ...sessionHeader,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  })
  const text = await response.text()
  const data = text.startsWith('{') ? text : (/^data: (.+)$/m.exec(text)?.[1] ?? '{}')

  return { message: JSON.parse(data), session: response.headers.get('mcp-session-id') }
}

/** Calls one Nuphos tool the way a real agent does. */
async function call(sessionId, name, args) {
  const server = tools.get(sessionId)
  const opened = await mcp(server, {}, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e-fixture', version: '1' },
  })
  const { message } = await mcp(
    server,
    opened.session ? { 'mcp-session-id': opened.session } : {},
    'tools/call',
    { name, arguments: args },
  )

  return message
}

const refused = (message) => Boolean(message.error ?? message.result?.isError)

/** Asks the person a question through request_user_decision. */
async function ask(sessionId, category) {
  const message = await call(sessionId, 'request_user_decision', {
    label: 'Ask which marker to use',
    category,
    question: 'Which marker should the fixture use?',
    // A link the app can open without leaving this computer.
    body: `Background is at ${new URL(tools.get(sessionId).url).origin}/health/ready`,
    options: ['E2E_DELIVERY:answered', 'E2E_DELIVERY:other'],
  })

  log({ sessionId, event: 'asked', isError: refused(message) })
}

/** Starts a sub-agent on an agent other than this one, in fast mode when asked. */
async function delegate(sessionId, fast) {
  const listed = await call(sessionId, 'list_agent_runtimes', { label: 'List the agents' })
  const other = listed.result?.structuredContent?.runtimes?.find((runtime) => !runtime.current)
  const message = await call(sessionId, 'create_thread', {
    label: 'Delegate to another agent',
    title: 'E2E child',
    prompt: `Child task E2E_DELIVERY:${fast ? 'child-fast' : 'child'}`,
    runtimeId: other?.runtimeId,
    ...(fast ? { fast: 'on' } : {}),
  })

  log({
    sessionId,
    event: 'delegated',
    isError: refused(message),
    detail: message.error?.message ?? message.result?.content?.[0]?.text,
  })
}

async function prompt({ sessionId, prompt: parts }) {
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const marker = (text.match(/E2E_DELIVERY:[a-z0-9-]+/g) ?? []).at(-1) ?? 'E2E_DELIVERY:missing'

  log({ sessionId, marker, event: 'start' })
  if (text.includes('E2E_DELEGATE')) await delegate(sessionId, text.includes('E2E_DELEGATE_FAST'))
  if (text.includes('E2E_ASK')) {
    await ask(sessionId, text.includes('E2E_ASK_CREDENTIAL') ? 'credential' : 'preference')
  }
  if (text.includes('E2E_HOLD')) {
    await new Promise((resolve) => held.set(sessionId, resolve))
    log({ sessionId, marker, event: 'cancelled' })

    return { stopReason: 'cancelled' }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
  send({
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `ACK ${marker}` },
      },
    },
  })
  log({ sessionId, marker, event: 'finish' })

  return { stopReason: 'end_turn' }
}

async function answer(request) {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'e2e-fixture', version: '1' },
        authMethods: [],
      }
    case 'session/new': {
      const sessionId = randomUUID()

      tools.set(
        sessionId,
        request.params.mcpServers?.find(({ name }) => name === 'nuphos-tools'),
      )

      // The settings the conversation was created with, which a real runtime applies here.
      const defaults = request.params._meta?.['ai.nuphos/runtimeDefaults'] ?? {}

      for (const [id, value] of Object.entries(defaults)) applySetting(sessionId, id, value)
      log({ sessionId, event: 'session', defaults })

      return { sessionId, configOptions: applySetting(sessionId) }
    }
    case 'session/prompt':
      return prompt(request.params)
    case 'session/load':
      log({ sessionId: request.params.sessionId, event: 'loaded' })

      return {}
    case 'session/set_mode':
      return {}
    case 'session/set_config_option': {
      const { sessionId, configId, value } = request.params

      return { configOptions: applySetting(sessionId, configId, value) }
    }
    default:
      throw new Error(`Unsupported fixture method: ${request.method}`)
  }
}

// Requests are answered as they finish, not in order: a held prompt must not
// keep the cancel that ends it from being read.
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)

  if (request.method === 'session/cancel') {
    held.get(request.params.sessionId)?.()
    held.delete(request.params.sessionId)
  }
  if (request.id === undefined) continue
  answer(request).then(
    (result) => send({ id: request.id, result }),
    (error) => send({ id: request.id, error: { code: -32601, message: error.message } }),
  )
}
