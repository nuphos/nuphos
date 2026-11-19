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

/** E2E_CALL <tool> <JSON arguments>: calls that tool and logs its answer, for arguments only a scenario knows. */
export async function callNamed({ log, sessionId, text }) {
  const [, name, args] = /E2E_CALL (\S+) (\{.*\})/.exec(text) ?? []
  const message = await call(sessionId, name, JSON.parse(args ?? '{}'))

  log({ sessionId, event: 'called', name, result: message.result ?? message.error })
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
    result: { status: response.status, code: body.code },
  })
}

/** #3329: a Task on this same agent, as a Bot hands off work; a chat escapes E2E_CALL's JSON. */
export async function subtask({ log, sessionId, marker }) {
  // #3409 hands off a second one, which its scenario tells apart by name.
  const kid = marker.includes('unlisted') ? 'unlisted-kid' : 'bot-kid'
  const message = await call(sessionId, 'create_thread', {
    label: 'Hand off',
    title: `E2E ${kid.replace('-', ' ')}`,
    // #3409's waits for its scenario's release, so it is still running when the sidebar lists it.
    prompt: `Reply ${kid === 'unlisted-kid' ? 'E2E_WAIT_RELEASE ' : ''}E2E_DELIVERY:${kid}`,
  })

  log({
    sessionId,
    marker,
    event: 'subtask',
    isError: Boolean(message.error ?? message.result?.isError),
  })
}
