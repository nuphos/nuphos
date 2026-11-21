// Runs a first turn on the OpenCode that findAgentCli picks, through the runtime's ACP shim, as
// Desktop does: the shim spawns the CLI without a shell. It must not pick npm's opencode.cmd, which
// Node refuses to spawn that way (EINVAL).
// Usage: node windows-npm-opencode-turn.ts <agent-cli-find module> <acp-shim.mjs>
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const [modulePath, shimPath] = process.argv.slice(2)

if (!modulePath || !shimPath)
  throw new Error('usage: windows-npm-opencode-turn.ts <agent-cli-find module> <acp-shim.mjs>')
const { findAgentCli } = (await import(pathToFileURL(path.resolve(modulePath)).href)) as {
  findAgentCli: (provider: 'opencode', env: NodeJS.ProcessEnv) => string | null
}
const cli = findAgentCli('opencode', process.env)

console.log(`findAgentCli: ${cli}`)
if (!cli || cli.toLowerCase().endsWith('.cmd')) throw new Error('no spawnable OpenCode found')

// Desktop's shimEnv: an empty home of its own, so no login; OpenCode's free models need none.
const home = mkdtempSync(path.join(os.tmpdir(), 'nuphos-opencode-home-'))
const shim = spawn(process.execPath, [path.resolve(shimPath), 'opencode'], {
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    NUPHOS_AGENT_EXECUTABLE: cli,
    NUPHOS_AGENT_HOME: home,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: process.env.OPENCODE_MODEL }),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
  windowsHide: true,
})
const timer = setTimeout(() => {
  shim.kill()
  throw new Error('no answer within 3 minutes')
}, 180_000)
const pending = new Map<number, (message: { result?: unknown; error?: unknown }) => void>()
let reply = ''
let nextId = 0

shim.on('exit', (code) => {
  if (pending.size) throw new Error(`the shim exited with ${code} before answering`)
})
createInterface({ input: shim.stdout }).on('line', (line) => {
  const message = JSON.parse(line)

  if (message.method === 'session/update') {
    const update = message.params.update

    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text')
      reply += update.content.text
  } else if (message.method && message.id !== undefined) {
    shim.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported' } })}\n`,
    )
  } else if (pending.has(message.id)) {
    pending.get(message.id)!(message)
    pending.delete(message.id)
  }
})

async function request(method: string, params: unknown): Promise<Record<string, unknown>> {
  const id = ++nextId
  const message = await new Promise<{ result?: unknown; error?: unknown }>((resolve) => {
    pending.set(id, resolve)
    shim.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })

  if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`)

  return message.result as Record<string, unknown>
}

await request('initialize', { protocolVersion: 1, clientCapabilities: {} })
const { sessionId } = await request('session/new', { cwd: home, mcpServers: [] })
const { stopReason } = await request('session/prompt', {
  sessionId,
  prompt: [{ type: 'text', text: 'Reply with the single word pong and nothing else.' }],
})

clearTimeout(timer)
shim.kill()
console.log(`stopReason: ${stopReason}\nreply: ${reply}`)
if (stopReason !== 'end_turn' || !reply.trim()) throw new Error('the first turn did not finish')
console.log('the first turn finished')
