// Deterministic model substitute, behind the real OpenAB executable and ACP transport.
// No network tools, GitHub credentials, or real inference are used.
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const log = (entry) => appendFileSync(process.env.E2E_ACP_LOG, `${JSON.stringify(entry)}\n`)
// A prompt containing E2E_HOLD stays in its turn until the client cancels it.
const held = new Map()
// The Nuphos tools server each session was given, when the backend offers one.
const tools = new Map()
// Requests this agent made of its client, waiting for their answers.
const asked = new Map()
// The thread E2E_THREAD started last, for E2E_POKE to message.
let thread

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

/** Calls one Nuphos tool the way a real agent does; `refused` is a tool error. */
async function tool(sessionId, name, args) {
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

  return {
    refused: Boolean(message.error ?? message.result?.isError),
    text: JSON.stringify(message),
  }
}

/** Asks the person a question through request_user_decision. */
async function ask(sessionId, category) {
  const server = tools.get(sessionId)
  const { refused } = await tool(sessionId, 'request_user_decision', {
    label: 'Ask which marker to use',
    category,
    question: 'Which marker should the fixture use?',
    // A link the app can open without leaving this computer.
    body: `Background is at ${new URL(server.url).origin}/health/ready`,
    options: ['E2E_DELIVERY:answered', 'E2E_DELIVERY:other'],
  })

  log({ sessionId, event: 'asked', isError: refused })
}

/** Starts a thread that asks for a permission, then tries to move it to Auto Mode on its own. */
async function startThread(sessionId, marker) {
  const started = await tool(sessionId, 'create_thread', {
    label: 'Start a thread',
    title: 'E2E thread',
    prompt: 'Run a command E2E_PERMISSION E2E_DELIVERY:thread',
  })

  thread = /threadId[\\"]*:[\\"]*([0-9a-f-]{36})/.exec(started.text)?.[1]
  const change = await tool(sessionId, 'update_thread', {
    label: 'Move the thread to Auto Mode',
    threadId: thread,
    fullAccess: false,
  })

  log({ sessionId, marker, event: change.refused ? 'thread-mode-refused' : 'thread-mode-changed' })
}

/** Asks the client to allow a command, as a runtime does before it runs one. */
async function permission(sessionId, marker) {
  const id = randomUUID()
  const answered = new Promise((resolve) => asked.set(id, resolve))

  log({ sessionId, marker, event: 'permission-asked' })
  send({
    id,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: { toolCallId: randomUUID(), title: 'echo e2e', kind: 'execute', status: 'pending' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    },
  })
  const outcome = (await answered)?.outcome

  log({ sessionId, marker, event: `permission-${outcome?.optionId ?? outcome?.outcome ?? 'none'}` })
}

async function prompt({ sessionId, prompt: parts }) {
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const marker = (text.match(/E2E_DELIVERY:[a-z0-9-]+/g) ?? []).at(-1) ?? 'E2E_DELIVERY:missing'

  log({ sessionId, marker, event: 'start' })
  if (text.includes('E2E_ASK')) {
    await ask(sessionId, text.includes('E2E_ASK_CREDENTIAL') ? 'credential' : 'preference')
  }
  if (text.includes('E2E_THREAD')) await startThread(sessionId, marker)
  if (text.includes('E2E_POKE')) {
    await tool(sessionId, 'send_message_to_thread', {
      label: 'Message the thread',
      threadId: thread,
      prompt: 'Run it again E2E_PERMISSION E2E_DELIVERY:thread-again',
    })
  }
  if (text.includes('E2E_PERMISSION')) await permission(sessionId, marker)
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

      return { sessionId }
    }
    case 'session/prompt':
      return prompt(request.params)
    case 'session/load':
      log({ sessionId: request.params.sessionId, event: 'loaded' })

      return {}
    case 'session/set_mode':
    case 'session/set_config_option':
      return {}
    default:
      throw new Error(`Unsupported fixture method: ${request.method}`)
  }
}

// Requests are answered as they finish, not in order: a held prompt must not
// keep the cancel that ends it from being read.
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)

  // An answer to a request of this agent's own.
  if (request.method === undefined) {
    asked.get(request.id)?.(request.result)
    asked.delete(request.id)
    continue
  }
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
