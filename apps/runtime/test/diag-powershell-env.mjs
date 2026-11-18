// Temporary #3496 diagnostic: is the slow start the runner image's, without Nuphos?
import { spawnSync } from 'node:child_process'

const ps = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const run = (label, env) => {
  const t = Date.now()
  spawnSync(ps, ['-NoProfile', '-Command', 'Write-Output NUPHOS_OK'], { env, stdio: 'ignore', timeout: 90000 })
  console.log(`${label} run: ${Date.now() - t} ms`)
}
const { PSModuleAnalysisCachePath, ...withoutCache } = process.env
console.log(`runner PSModuleAnalysisCachePath set: ${Boolean(PSModuleAnalysisCachePath)}`)
for (const n of [1, 2]) run(`full env ${n}`, { ...process.env })
for (const n of [1, 2, 3]) run(`full env without PSModuleAnalysisCachePath ${n}`, withoutCache)
