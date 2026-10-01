#!/usr/bin/env bun

// Local dev for on-prem clusters — the relay is the one piece a local backend
// cannot fake. Foreground usage: bun scripts/dev-onprem.ts relay | agent <token>
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Matches the value the backend must be started with; see printEnvHint. */
const DEV_SECRET = 'nuphos-local-dev-relay-secret-32b!'
// The agent listener has to be reachable from a local Kind/Docker Desktop pod.
// Keep the operator-facing proxy and health listeners on loopback below.
const AGENT_LISTEN_ADDR = '0.0.0.0:18444'
const AGENT_DIAL_ADDR = '127.0.0.1:18444'
const IN_CLUSTER_AGENT_ENDPOINT = 'host.docker.internal:18444'
const PROXY_ADDR = '127.0.0.1:18443'
const HEALTH_ADDR = '127.0.0.1:18080'

const repoRoot = path.resolve(import.meta.dir, '..')

function run(cwd: string, command: string[], env: Record<string, string>): never {
  if (!existsSync(path.join(cwd, 'go.mod'))) {
    console.error(`No go.mod in ${cwd} — run this from a checkout of the monorepo.`)
    process.exit(1)
  }
  const child = spawn(command[0]!, command.slice(1), {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })

  child.on('exit', (code) => process.exit(code ?? 0))
  child.on('error', (err) => {
    console.error(`Could not start ${command.join(' ')}: ${err.message}`)
    console.error('Go 1.25+ has to be on PATH.')
    process.exit(1)
  })

  // spawn keeps the process alive; the exit handler above ends it.
  return undefined as never
}

function printEnvHint(): void {
  console.log('\nBackend env for this relay — put these in apps/backend/.env, then restart it:\n')
  console.log(`NUPHOS_RELAY_TOKEN_SECRET=${DEV_SECRET}`)
  console.log(`NUPHOS_RELAY_AGENT_ENDPOINT=${IN_CLUSTER_AGENT_ENDPOINT}`)
  // http:// because this relay is plaintext; a real deployment omits the scheme.
  console.log(`NUPHOS_RELAY_PROXY_ENDPOINT=http://${PROXY_ADDR}`)
  console.log(`NUPHOS_RELAY_STATUS_URL=http://${HEALTH_ADDR}\n`)
}

const [command, argument] = process.argv.slice(2)

if (command === 'relay') {
  printEnvHint()
  console.log(
    `Relay listening: agents ${AGENT_LISTEN_ADDR} · proxy ${PROXY_ADDR} · health ${HEALTH_ADDR}`,
  )
  console.log('Plaintext local development only — never run it this way anywhere else.\n')
  run(path.join(repoRoot, 'apps/kube-relay'), ['go', 'run', '.'], {
    NUPHOS_RELAY_TOKEN_SECRET: DEV_SECRET,
    NUPHOS_RELAY_AGENT_ADDR: AGENT_LISTEN_ADDR,
    NUPHOS_RELAY_PROXY_ADDR: PROXY_ADDR,
    NUPHOS_RELAY_HEALTH_ADDR: HEALTH_ADDR,
    NUPHOS_RELAY_DEV_PLAINTEXT: '1',
  })
} else if (command === 'agent') {
  if (!argument?.startsWith('nr1_')) {
    console.error('Pass the enrolment token from the wizard: bun scripts/dev-onprem.ts agent nr1_…')
    process.exit(1)
  }
  console.log(`Agent dialling ${AGENT_DIAL_ADDR}. It reaches whatever this machine reaches —`)
  console.log(
    'so a kubeconfig for a local kind/minikube/Docker Desktop cluster works end to end.\n',
  )
  run(path.join(repoRoot, 'apps/kube-relay-agent'), ['go', 'run', '.'], {
    NUPHOS_RELAY_ENDPOINT: AGENT_DIAL_ADDR,
    NUPHOS_RELAY_TOKEN: argument,
    // The dev relay speaks plaintext, so there is no TLS to negotiate at all.
    NUPHOS_RELAY_DEV_PLAINTEXT: '1',
    NUPHOS_RELAY_POOL_SIZE: '2',
  })
} else {
  console.error('Usage: bun scripts/dev-onprem.ts relay | agent <token>')
  process.exit(1)
}
