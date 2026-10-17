import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

// The patched adapter unsubscribes before thread/resume so a teammate's load
// applies their shell environment. This pins the App Server behaviour that
// relies on: a resume is ignored while subscribed, and applied once released.
const binary = process.argv[2]

if (!binary) throw new Error('Usage: node test/codex-resume-env-smoke.mjs <codex binary>')
const base = mkdtempSync(join(tmpdir(), 'nuphos-codex-resume-smoke-'))

mkdirSync(join(base, '.codex'))
const child = spawn(resolve(binary), ['app-server'], {
  cwd: base,
  env: { PATH: process.env.PATH, HOME: base, CODEX_HOME: join(base, '.codex') },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const exited = once(child, 'exit')
let next = 0
const pending = new Map()
let stderr = ''

child.stderr.on('data', (data) => {
  stderr += data
})
createInterface({ input: child.stdout }).on('line', (line) => {
  const message = JSON.parse(line)
  const settle = pending.get(message.id)

  if (settle) {
    pending.delete(message.id)
    settle(message)
  }
})
const rpc = async (method, params) => {
  const id = ++next
  const response = new Promise((settle) => pending.set(id, settle))

  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  const result = await Promise.race([
    response,
    exited.then(([code]) => {
      throw new Error(`Codex exited (${code}): ${stderr}`)
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${method}: ${stderr}`)), 15000).unref(),
    ),
  ])

  assert.equal(result.error, undefined, JSON.stringify(result.error))

  return result.result
}
const config = (actor) => ({
  shell_environment_policy: { inherit: 'core', set: { NUPHOS_SMOKE_ACTOR: actor } },
})
const out = join(base, 'actor')
// The actor a shell in the thread sees, through the thread's own environment.
const actorOf = async (threadId) => {
  rmSync(out, { force: true })
  await rpc('thread/shellCommand', {
    threadId,
    command: `printf %s "$NUPHOS_SMOKE_ACTOR" > ${out}`,
  })
  for (let i = 0; i < 100 && !(existsSync(out) && readFileSync(out, 'utf8')); i++)
    await new Promise((settle) => setTimeout(settle, 100))

  return existsSync(out) ? readFileSync(out, 'utf8') : ''
}

try {
  await rpc('initialize', { clientInfo: { name: 'nuphos-resume-smoke', version: '1' } })
  const { thread } = await rpc('thread/start', { cwd: base, config: config('owner') })

  assert.equal(await actorOf(thread.id), 'owner')
  await rpc('thread/resume', { threadId: thread.id, config: config('guest') })
  assert.equal(await actorOf(thread.id), 'owner', 'App Server now applies a subscribed resume')
  await rpc('thread/unsubscribe', { threadId: thread.id })
  await rpc('thread/resume', { threadId: thread.id, config: config('guest') })
  assert.equal(await actorOf(thread.id), 'guest', 'A released thread kept its old environment')
  console.log(
    'PASS real Codex App Server: a released thread resumes with the new shell environment',
  )
} finally {
  child.stdin.end()
  child.kill()
  await exited
  rmSync(base, { recursive: true, force: true })
}
