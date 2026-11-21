// The fixture's Nuphos tools client: the streamable-HTTP MCP server each session was given.
import { randomUUID } from 'node:crypto'

// The Nuphos tools server each session was given, when the backend offers one.
const tools = new Map()

export const toolsServer = (sessionId) => tools.get(sessionId)
export const setToolsServer = (sessionId, server) => tools.set(sessionId, server)

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
export async function call(sessionId, name, args) {
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

/** `call`, reported to the client as a step of the turn, as real agents report their calls. */
export const reporting = (send) => async (sessionId, name, args) => {
  const toolCallId = randomUUID()
  const update = (fields) =>
    send({ method: 'session/update', params: { sessionId, update: { toolCallId, ...fields } } })

  update({
    sessionUpdate: 'tool_call',
    // Claude Code's name for a tool of the `nuphos-tools` server.
    title: `mcp__nuphos-tools__${name}`,
    kind: 'other',
    status: 'in_progress',
    rawInput: args,
  })
  const message = await call(sessionId, name, args)

  update({
    sessionUpdate: 'tool_call_update',
    status: (message.error ?? message.result?.isError) ? 'failed' : 'completed',
    rawOutput: message.result,
  })

  return message
}

/** E2E_CALL's arguments; a Bot's chat post reaches its prompt as a JSON string, escaped. */
function parseArgs(args) {
  try {
    return JSON.parse(args)
  } catch {
    return JSON.parse(JSON.parse(`"${args}"`))
  }
}

/** E2E_CALL <tool> <JSON arguments>: calls that tool and logs its answer, for arguments only a scenario knows. */
export async function callNamed({ log, sessionId, text }) {
  // One call per line, in order, all in this turn's conversation (#3887 drives one tab with several).
  for (const [, name, args] of text.matchAll(/E2E_CALL (\S+) (\{.*\})/g)) {
    const message = await call(sessionId, name, parseArgs(args))

    log({ sessionId, event: 'called', name, result: message.result ?? message.error })
    if (name === 'request_user_decision') {
      const id = /(nuphos-[0-9a-f-]{36})/.exec(JSON.stringify(message.result))?.[1]

      if (id) lastAsked.set(sessionId, id)
    }
  }
}

// The question each session asked last through E2E_CALL, for E2E_RECHECK.
const lastAsked = new Map()

/** E2E_RECHECK (#4175): looks again at the question this turn asked, as an agent that heard nothing back does. */
export async function recheck({ log, sessionId }) {
  const requestId = lastAsked.get(sessionId)
  const checks = [
    ['list_user_decisions', { label: 'List my questions' }],
    ['update_user_decision', { label: 'Correct it', requestId, body: 'Still waiting on you.' }],
    ['withdraw_user_decision', { label: 'Withdraw it', requestId }],
  ]

  for (const [name, args] of checks) {
    const message = await call(sessionId, name, args)

    log({ sessionId, event: 'called', name, result: message.result ?? message.error })
  }
}

/** E2E_PERSONAL_TOKEN:<provider>: fetches the owner's own credential as an agent's setup script does, and logs the answer. */
export async function personalToken({ log, sessionId, marker, text }) {
  const provider = /E2E_PERSONAL_TOKEN:([a-z-]+)/.exec(text)?.[1]
  const server = tools.get(sessionId)
  // The handout sits under the same /teams/:teamId as the tools server, for the same token.
  const team = server.url.replace(/\/agent-sessions\/[^/]+(\/teams\/[^/]+)\/mcp-tools.*$/, '$1')
  const response = await fetch(`${team}/personal-credentials/${provider}/token`, {
    headers: Object.fromEntries(server.headers.map(({ name, value }) => [name, value])),
  })
  const body = await response.json().catch(() => ({}))

  log({
    sessionId,
    marker,
    event: 'personal-token',
    name: provider,
    result: { status: response.status, code: body.error?.code },
  })
}

/** #3329: a Task on this same agent, as a Bot hands off work; a chat escapes E2E_CALL's JSON. */
export async function subtask({ log, sessionId, marker }) {
  // #3409 and #4156 hand off more, which their scenarios tell apart by name.
  const name = /E2E_DELIVERY:(unlisted|par-[a-z])/.exec(marker)?.[1]
  const kid = name ? `${name}-kid` : 'bot-kid'
  const message = await call(sessionId, 'create_thread', {
    label: 'Hand off',
    title: `E2E ${kid.replaceAll('-', ' ')}`,
    // Those wait for their scenario's release, so they are still running meanwhile.
    prompt: `Reply ${name ? 'E2E_WAIT_RELEASE ' : ''}E2E_DELIVERY:${kid}`,
  })

  log({
    sessionId,
    marker,
    event: 'subtask',
    isError: Boolean(message.error ?? message.result?.isError),
  })
}
