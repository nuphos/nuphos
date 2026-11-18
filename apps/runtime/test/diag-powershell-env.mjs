// Temporary #3496 diagnostic: does PowerShell keep its module analysis cache in a session home?
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { nuphosCodexSessionConfig } from '../image/codex-acp/session-config.mjs'

const ps = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const scopedFor = (id) =>
  nuphosCodexSessionConfig({}, { 'ai.nuphos/codex': { env: { NUPHOS_SESSION_ID: id } } }, process.env)
    .shell_environment_policy.set
const cache = (env) => join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'PowerShell')
const run = (label, env) => {
  const t = Date.now()
  const r = spawnSync(ps, ['-NoProfile', '-Command', 'Write-Output NUPHOS_OK'], { env, encoding: 'utf8', timeout: 90000 })
  console.log(`${label}: ${Date.now() - t} ms, LOCALAPPDATA exists ${existsSync(env.LOCALAPPDATA)}, cache dir exists ${existsSync(cache(env))}, stderr ${JSON.stringify(r.stderr.slice(0, 200))}`)
}
const missing = scopedFor('diag-missing')
run('no AppData run 1', missing)
run('no AppData run 2', missing)
const made = scopedFor('diag-made')
mkdirSync(made.LOCALAPPDATA, { recursive: true })
run('AppData\\Local made run 1', made)
run('AppData\\Local made run 2', made)
run('AppData\\Local made run 3', made)
