// OpenAB runtime job `panel`: stdin is {runner, script, params}. The panel's stdout
// is the job's stdout, and its exit code is the job's exit code.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'

function fail(message) {
  process.stderr.write(`panel-job: ${message}\n`)
  process.exit(2)
}

let input

try {
  input = JSON.parse(await text(process.stdin))
} catch {
  fail('stdin is not JSON')
}

const { runner, script, params } = input ?? {}

if (typeof runner !== 'string' || typeof script !== 'string') {
  fail('runner and script must be strings')
}
if (params === null || typeof params !== 'object' || Array.isArray(params)) {
  fail('params must be an object')
}

const runDir = await mkdtemp(join(tmpdir(), 'panel-'))

try {
  await writeFile(join(runDir, 'runner.mjs'), runner)
  await writeFile(join(runDir, 'script.mjs'), script)
  await writeFile(join(runDir, 'params.json'), JSON.stringify(params))

  // execArgv carries this job's heap ceiling to the panel, which is what it bounds.
  const panel = spawn(process.execPath, [...process.execArgv, join(runDir, 'runner.mjs'), runDir], {
    cwd: runDir,
    stdio: ['ignore', 'inherit', 'ignore'],
  })
  const [code, signal] = await new Promise((resolve, reject) => {
    panel.once('error', reject)
    panel.once('exit', (exitCode, exitSignal) => resolve([exitCode, exitSignal]))
  })

  process.exitCode = code ?? 128 + (constants.signals[signal] ?? 0)
} finally {
  await rm(runDir, { recursive: true, force: true })
}
