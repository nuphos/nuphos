// Another computer, as `nuphos agent` runs one: the real host on a home of its own, with no
// agent CLI. Adding an agent there installs fixture-install.sh's `claude`.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { backendLog } from './backend-log.ts'
import { artifacts, spawn, stop, until } from './processes.ts'

import type { Stack } from './stack.ts'

const DESKTOP_DIR = resolve(import.meta.dirname, '../../apps/desktop')

export async function startSecondComputer(stack: Stack, label: string) {
  const deviceId = randomUUID()
  const home = join(artifacts, `computer-${deviceId.slice(0, 8)}`)
  const agentHome = join(home, '.nuphos-agent')
  // Beside the app's node_modules, which the host resolves its keyring module from.
  const host = join(DESKTOP_DIR, 'build', 'e2e-host.mjs')

  // Signed in as `nuphos login` leaves it, beside the app's sign-in files the artifacts leave out.
  const cliConfig = join(artifacts, 'sign-in', `computer-${deviceId.slice(0, 8)}.yaml`)

  mkdirSync(agentHome, { recursive: true })
  mkdirSync(dirname(cliConfig), { recursive: true })
  writeFileSync(cliConfig, `token: ${stack.token}\n`, { mode: 0o600 })
  writeFileSync(
    join(agentHome, 'device-identity.json'),
    JSON.stringify({ deviceId, label, createdAt: new Date().toISOString() }),
  )
  execFileSync(
    'bun',
    [
      'build',
      'electron/main/local-runtime/cli-host.ts',
      '--target=node',
      '--format=esm',
      '--external',
      '@napi-rs/keyring',
      `--outfile=${host}`,
    ],
    { cwd: DESKTOP_DIR, stdio: 'ignore' },
  )
  const child = spawn(`computer-${label}`, ['node', host], {
    env: {
      HOME: home,
      NUPHOS_AGENT_HOME: agentHome,
      NUPHOS_LOCAL_RUNTIME_DIR: join(DESKTOP_DIR, 'build', 'local-runtime', 'linux-x64'),
      NUPHOS_API_URL: stack.apiUrl,
      NUPHOS_CLI_CONFIG: cliConfig,
      NUPHOS_E2E_AGENT_INSTALLER: resolve(import.meta.dirname, 'fixture-install.sh'),
    },
  })

  await until(`${label} to connect`, async () =>
    backendLog().some(
      (line) => line.includes('tunnel_opened') && line.includes(`"device_id":"${deviceId}"`),
    ),
  )

  return { deviceId, stop: () => stop(child) }
}
