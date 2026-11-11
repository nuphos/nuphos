import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, delimiter } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
} from '../image/pi-acp/node_modules/@agentclientprotocol/sdk/dist/acp.js'

const root = resolve(process.env.NUPHOS_TEST_ROOT || '.work/pi-live')
const home = resolve(root, 'home')
const workspace = resolve(root, 'workspace', randomUUID())
assert(process.env.NUPHOS_PI_CONFIG_DIR, 'Set NUPHOS_PI_CONFIG_DIR to real Pi configuration')
await mkdir(workspace, { recursive: true })
await mkdir(home, { recursive: true })
const conversation = randomUUID()
const marker = randomUUID()
const events = []
let onIdle
const metadata = (actor) => ({
  'ai.nuphos/session': {
    env: { NUPHOS_SESSION_ID: conversation, ...(actor ? { NUPHOS_SESSION_ACTOR: actor } : {}) },
    systemPrompt:
      'Use the supplied workspace for testing. Never inspect credentials or directories outside the workspace.',
  },
})
const servers = process.env.NUPHOS_TEST_MCP_COMMAND
  ? [
      {
        name: 'filesystem',
        command: process.env.NUPHOS_TEST_MCP_COMMAND,
        args: [workspace],
        env: [],
      },
    ]
  : []
function connect() {
  const child = spawn(process.execPath, [resolve('apps/runtime/image/acp-shim.mjs'), 'pi'], {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: home,
      NUPHOS_RUNTIME_WORKSPACE: workspace,
      PATH: [resolve('apps/runtime/image/pi-acp/node_modules/.bin'), process.env.PATH].join(
        delimiter,
      ),
      PI_CODING_AGENT_DIR: resolve(process.env.NUPHOS_PI_CONFIG_DIR),
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate: async (event) => {
        events.push(event.update)
        if (event.update._meta?.['ai.nuphos/sessionState']?.state === 'idle') onIdle?.()
      },
      requestPermission: async () => {
        throw new Error('Unexpected permission request in Pi live test')
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )
  return { child, connection }
}
const timer = setTimeout(() => {
  throw new Error('Pi live test exceeded 600 seconds')
}, 600_000)
let active = connect()
try {
  await active.connection.initialize({ protocolVersion: 1, clientCapabilities: {} })
  const session = await active.connection.newSession({
    cwd: workspace,
    mcpServers: servers,
    _meta: metadata(),
  })
  assert(session.sessionId)
  assert(session.configOptions?.some((option) => option.category === 'model'))
  const prompt = `Remember the secret test marker ${marker} in this conversation. Use the write tool to create proof.txt containing exactly pi-runtime-ok. ${servers.length ? 'Then use the filesystem MCP list_directory tool to list this workspace.' : ''} Finally reply with the marker.`
  await active.connection.prompt({
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: prompt }],
  })
  assert.equal((await readFile(resolve(workspace, 'proof.txt'), 'utf8')).trim(), 'pi-runtime-ok')
  assert(events.some((event) => event.sessionUpdate === 'tool_call'))
  if (servers.length)
    assert(events.some((event) => JSON.stringify(event).includes('mcp__filesystem')))
  console.error('Pi live: tool execution completed; reconnecting as a teammate')
  active.child.stdin.end()
  await active.connection.closed
  active = connect()
  events.length = 0
  await active.connection.initialize({ protocolVersion: 1, clientCapabilities: {} })
  await active.connection.loadSession({
    sessionId: session.sessionId,
    cwd: workspace,
    mcpServers: servers,
    _meta: metadata('teammate'),
  })
  events.length = 0
  const idle = new Promise((resolveIdle) => {
    onIdle = resolveIdle
  })
  await active.connection.prompt({
    sessionId: session.sessionId,
    prompt: [
      {
        type: 'text',
        text: 'What was the secret test marker from the previous turn? Reply with only that marker; do not read files.',
      },
    ],
  })
  await idle
  const text = events
    .filter((event) => event.sessionUpdate === 'agent_message_chunk')
    .map((event) => event.content?.text ?? '')
    .join('')
  assert(text.includes(marker), 'A teammate must be able to resume the persisted conversation')
  assert(events.some((event) => event._meta?.['ai.nuphos/sessionState']?.state === 'idle'))
  console.log(
    JSON.stringify({
      passed: true,
      model: 'real configured provider',
      tools: true,
      mcp: servers.length > 0,
      restart: true,
      teammateResume: true,
    }),
  )
} finally {
  clearTimeout(timer)
  active.child.stdin.end()
  await active.connection.closed
}
