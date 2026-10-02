import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const JOB = fileURLToPath(new URL('../image/panel-job.mjs', import.meta.url))

// Invoked the way the backend's sandbox runner did: `node runner.mjs <runDir>`, with the
// script and params beside it.
const RUNNER = `
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const runDir = process.argv[2]
const params = JSON.parse(await readFile(join(runDir, 'params.json'), 'utf8'))
const { default: output } = await import(join(runDir, 'script.mjs'))
process.stderr.write('stderr is not part of the result\\n')
process.stdout.write('__PANEL_OUTPUT__' + JSON.stringify({ output, params, token: process.env.NUPHOS_TOKEN, cwd: process.cwd(), heap: process.execArgv }) + '\\n')
process.exit(params.exitCode ?? 0)
`

async function runJob(stdin, env = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'panel-job-test-'))
  const child = spawn(process.execPath, ['--max-old-space-size=128', JOB], {
    env: { PATH: process.env.PATH, TMPDIR: scratch, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  child.stdin.end(stdin)
  const code = await new Promise((resolve) => child.once('exit', resolve))
  const leftovers = await readdir(scratch)

  await rm(scratch, { recursive: true, force: true })

  return { code, stdout, stderr, leftovers }
}

test('runs the runner beside the script and params, passing stdout and the environment through', async () => {
  const { code, stdout, stderr, leftovers } = await runJob(
    JSON.stringify({
      runner: RUNNER,
      script: 'export default { kind: "stat", value: 42 }',
      params: { teamId: 't1' },
    }),
    { NUPHOS_TOKEN: 'tok' },
  )
  const line = stdout.trim()

  assert.equal(code, 0)
  assert.ok(line.startsWith('__PANEL_OUTPUT__'), stdout)
  const result = JSON.parse(line.slice('__PANEL_OUTPUT__'.length))

  assert.deepEqual(result.output, { kind: 'stat', value: 42 })
  assert.deepEqual(result.params, { teamId: 't1' })
  assert.equal(result.token, 'tok')
  assert.match(result.cwd, /panel-/u)
  assert.deepEqual(result.heap, ['--max-old-space-size=128'])
  assert.equal(stderr, '')
  assert.deepEqual(leftovers, [])
})

test("propagates the panel's exit code and still removes its directory", async () => {
  const { code, stdout, leftovers } = await runJob(
    JSON.stringify({ runner: RUNNER, script: 'export default 1', params: { exitCode: 3 } }),
  )

  assert.equal(code, 3)
  assert.ok(stdout.includes('__PANEL_OUTPUT__'))
  assert.deepEqual(leftovers, [])
})

test('rejects malformed input without writing to stdout', async () => {
  for (const stdin of [
    'not json',
    JSON.stringify({ runner: 1, script: '', params: {} }),
    JSON.stringify({ runner: '', script: '', params: [] }),
  ]) {
    const { code, stdout, leftovers } = await runJob(stdin)

    assert.equal(code, 2, stdin)
    assert.equal(stdout, '')
    assert.deepEqual(leftovers, [])
  }
})

test('the image lists the job for OpenAB with a 300s ceiling and ships the script', async () => {
  const dockerfile = await readFile(new URL('../image/Dockerfile', import.meta.url), 'utf8')

  assert.match(
    dockerfile,
    /^ENV OPENAB_RUNTIME_JOBS="panel=node --max-old-space-size=512 \/opt\/nuphos-runtime\/panel-job\.mjs;/mu,
  )
  assert.match(dockerfile, /^ {4}OPENAB_RUNTIME_JOB_MAX_TIMEOUT_MS=300000$/mu)
  assert.match(dockerfile, /^COPY [^\n]*panel-job\.mjs \/opt\/nuphos-runtime\/$/mu)
})
