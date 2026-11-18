// Temporary #3496 diagnostic: how long Windows PowerShell takes to start per environment.
import { spawnSync } from 'node:child_process'
import { nuphosCodexSessionConfig } from '../image/codex-acp/session-config.mjs'

const ps = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const scoped = nuphosCodexSessionConfig(
  {},
  { 'ai.nuphos/codex': { env: { NUPHOS_SESSION_ID: 'diag' } } },
  process.env,
).shell_environment_policy.set
const pick = (...keys) => Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
const cases = {
  full: { ...process.env },
  scoped,
  'scoped+TEMP': { ...scoped, ...pick('TEMP', 'TMP') },
  'scoped+windir': { ...scoped, ...pick('windir') },
  'scoped+PSModulePath': { ...scoped, ...pick('PSModulePath') },
  'scoped+realProfile': { ...scoped, ...pick('USERPROFILE', 'APPDATA', 'LOCALAPPDATA') },
  'scoped+ProgramData': { ...scoped, ...pick('ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ALLUSERSPROFILE', 'CommonProgramFiles') },
  'scoped+machine': { ...scoped, ...pick('COMPUTERNAME', 'USERDOMAIN', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS') },
}
for (const round of [1, 2])
  for (const [name, env] of Object.entries(cases)) {
    const t = Date.now()
    const r = spawnSync(ps, ['-NoProfile', '-Command', 'Write-Output NUPHOS_OK'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 })
    console.log(`round ${round} ${name}: ${Date.now() - t} ms exit ${r.status} ${String(r.stdout).trim()}`)
  }
