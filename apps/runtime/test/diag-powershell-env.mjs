// Temporary #3496 diagnostic: which variables make Windows PowerShell start slowly.
import { spawnSync } from 'node:child_process'
import { nuphosCodexSessionConfig } from '../image/codex-acp/session-config.mjs'

const ps = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const full = { ...process.env }
const scoped = nuphosCodexSessionConfig(
  {},
  { 'ai.nuphos/codex': { env: { NUPHOS_SESSION_ID: 'diag' } } },
  process.env,
).shell_environment_policy.set
const lower = (env) => new Set(Object.keys(env).map((k) => k.toLowerCase()))
const time = (env) => {
  const t = Date.now()
  spawnSync(ps, ['-NoProfile', '-Command', 'Write-Output NUPHOS_OK'], { env, stdio: 'ignore', timeout: 90000 })
  return Date.now() - t
}
const slow = (env) => time(env) > 5000
const missing = Object.keys(full).filter((k) => !lower(scoped).has(k.toLowerCase()))
console.log(`missing from scoped: ${missing.join(' ')}`)
console.log(`overridden by scoped: ${Object.keys(scoped).filter((k) => lower(full).has(k.toLowerCase()) && full[Object.keys(full).find((f) => f.toLowerCase() === k.toLowerCase())] !== scoped[k]).join(' ')}`)
const withMissing = (keys) => ({ ...scoped, ...Object.fromEntries(keys.map((k) => [k, full[k]])) })
console.log(`scoped + all missing: ${time(withMissing(missing))} ms`)
console.log(`full + scoped overrides: ${time({ ...full, ...scoped })} ms`)
if (!slow(withMissing(missing))) {
  let keep = [...missing]
  for (const key of missing) {
    const without = keep.filter((k) => k !== key)
    if (!slow(withMissing(without))) keep = without
  }
  console.log(`needed for a fast start: ${keep.join(' ')}`)
  console.log(`scoped + needed: ${time(withMissing(keep))} ms`)
}
