// When Codex's App Server dies, the patched adapter must fail the in-flight
// turn with the cause and exit, so OpenAB rebuilds the conversation's
// connection and the next message resumes it via session/load (as #787 does
// for Claude Code). Unpatched, the turn waits forever for turn/completed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { patchAdapter } from '../image/codex-acp/patch-adapter.mjs'

const source = fileURLToPath(
  new URL(
    '../image/codex-acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js',
    import.meta.url,
  ),
)
const helper = readFileSync(
  new URL('../image/codex-acp/session-config.mjs', import.meta.url),
  'utf8',
)

test('the adapter fails the turn with the cause and exits when Codex dies', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'nuphos-codex-death-'))

  t.after(() => rmSync(base, { recursive: true, force: true }))
  writeFileSync(join(base, 'patched.mjs'), patchAdapter(readFileSync(source, 'utf8'), helper))
  writeFileSync(join(base, 'requests.jsonl'), '')
  const child = spawn(process.execPath, [join(base, 'patched.mjs')], {
    env: {
      PATH: process.env.PATH,
      HOME: base,
      CODEX_PATH: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)),
      NUPHOS_SMOKE_RECORD: join(base, 'requests.jsonl'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const exited = once(child, 'exit')
  const responses = new Map()
  let next = 0

  t.after(() => child.kill('SIGKILL'))
  child.stderr.resume()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line)

    responses.get(msg.id)?.(msg)
  })
  const rpc = (method, params) => {
    const id = ++next

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)

    return new Promise((resolve) => responses.set(id, resolve))
  }
  const within = (promise, what) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`No ${what} within 10s`)), 10000).unref(),
      ),
    ])

  await rpc('initialize', { protocolVersion: 1, clientCapabilities: {} })
  const { result } = await rpc('session/new', { cwd: base, mcpServers: [] })
  const reply = await within(
    rpc('session/prompt', {
      sessionId: result.sessionId,
      prompt: [{ type: 'text', text: 'Fixture dies' }],
    }),
    'prompt reply',
  )

  assert.match(reply.error?.message ?? '', /Codex stopped unexpectedly \(.*SIGKILL.*\)/)
  assert.match(reply.error.message, /Send a message to continue/)
  const [code] = await within(exited, 'adapter exit')

  assert.equal(code, 1)
})
