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

/** Asks the person a question the way a real agent does, through request_user_decision. */
async function ask(sessionId) {
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
    {
      name: 'request_user_decision',
      arguments: {
        label: 'Ask which marker to use',
        category: 'preference',
        question: 'Which marker should the fixture use?',
        // A link the app can open without leaving this computer.
        body: `Background is at ${new URL(server.url).origin}/health/ready`,
        options: ['E2E_DELIVERY:answered', 'E2E_DELIVERY:other'],
      },
    },
  )

  log({ sessionId, event: 'asked', isError: Boolean(message.error ?? message.result?.isError) })
}

async function prompt({ sessionId, prompt: parts }) {
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const marker = (text.match(/E2E_DELIVERY:[a-z0-9-]+/g) ?? []).at(-1) ?? 'E2E_DELIVERY:missing'

  log({ sessionId, marker, event: 'start' })
  if (text.includes('E2E_ASK')) await ask(sessionId)
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
