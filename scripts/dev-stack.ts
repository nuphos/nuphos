// The local data plane under every dev backend: deploy/compose's mongo, rustfs
// and runtime with the dev override, one dashboard row each. Shared by all
// worktrees, so it is left running on quit; `bun run dev:reset` wipes it.
import { existsSync } from 'node:fs'

import { stripAnsi } from './dev-child-output.ts'
import { COMPOSE, COMPOSE_DIR, COMPOSE_ENV, RESET_ARGS, clearDevSignIn } from './dev-compose.ts'
import { markDirty, pushEvent } from './dev-event-log.ts'
import { readLocalStack } from './dev-local-stack-env.ts'
import { cleanupManagedAgents } from './dev-managed-cleanup.ts'
import { runDevCommand } from './dev-process.ts'
import { mongo, openLog, runtime, rustfs, startTiming, writeRaw } from './dev-services.ts'
import {
  NO_PULL,
  composeImages,
  errorTail,
  pullLabel,
  pullLine,
  singleFlight,
} from './dev-stack-state.ts'
import { looksStale, waitingNote } from './dev-store-health.ts'
import { setDownstreamNote, watchStores } from './dev-store-watch.ts'

import type { LocalStack } from './dev-local-stack-env.ts'
import type { Service } from './dev-services.ts'

export const STALE_HINT = 'if the stack predates this version, wipe it with bun run dev:reset'

function staleHint(tail: string): string {
  return looksStale(tail) ? ` (${STALE_HINT})` : ''
}

/** Compose-level milestones that belong to no single service. */
export const compose = { name: 'compose', color: '\x1b[32m' }

type Images = Record<string, { image: string; platform?: string }>

async function docker(
  rows: readonly Service[],
  args: string[],
  timeoutMs: number,
  onLine: (line: string) => void = () => {},
) {
  const output: string[] = []
  const record = (line: string) => {
    const plain = stripAnsi(line)

    output.push(plain)
    if (output.length > 50) output.shift()
    for (const row of rows) writeRaw(row, plain)
    onLine(plain)
  }
  const result = await runDevCommand('docker', args, {
    cwd: COMPOSE_DIR,
    timeoutMs,
    onStdout: record,
    onStderr: record,
  })

  return { ok: result.exitCode === 0, tail: errorTail(output) }
}

function failRows(rows: readonly Service[], message: string, tail: string) {
  for (const row of rows) {
    row.status = 'crashed'
    row.lastRaw = tail || row.lastRaw
    pushEvent(row, tail ? `${message}: ${tail}` : message)
  }
  markDirty()
}

export function resetRow(row: Service, url: string) {
  row.status = 'starting'
  row.health = {}
  row.readyMs = null
  row.stallNoticed = 0
  row.lastRaw = null
  row.url = url
  // The readiness clock starts once the container is being created, never during a pull.
  row.startedAt = null
  openLog(row)
}

async function imagePresent(image: string): Promise<boolean> {
  const result = await runDevCommand('docker', ['image', 'inspect', image], { timeoutMs: 20_000 })

  return result.exitCode === 0
}

async function pullImage(row: Service, images: Images): Promise<boolean> {
  const target = images[row.name]

  if (!target) return true
  const tag = target.image.split(':').at(-1) ?? target.image

  if (await imagePresent(target.image)) {
    row.health.image = tag

    return true
  }
  let progress = NO_PULL

  row.health.image = pullLabel(progress)
  pushEvent(row, `pulling ${target.image} …`)
  const platform = target.platform ? ['--platform', target.platform] : []
  const pull = await docker([row], ['pull', ...platform, target.image], 3_600_000, (line) => {
    const next = pullLine(progress, line)

    if (next === progress) return
    progress = next
    row.health.image = pullLabel(progress)
    markDirty()
  })

  if (!pull.ok) {
    failRows([row], `pulling ${target.image} failed`, pull.tail)

    return false
  }
  row.health.image = tag
  markDirty()

  return true
}

async function readImages(): Promise<Images | null> {
  let json = ''
  const result = await runDevCommand('docker', [...COMPOSE, 'config', '--format', 'json'], {
    cwd: COMPOSE_DIR,
    timeoutMs: 30_000,
    onStdout: (line) => {
      json += line
    },
  })

  try {
    return result.exitCode === 0 ? composeImages(json) : null
  } catch {
    return null
  }
}

async function ensureComposeEnv(): Promise<boolean> {
  if (existsSync(COMPOSE_ENV)) return true
  pushEvent(compose, 'no deploy/compose/.env — generating it with init-env.sh')
  const result = await runDevCommand('sh', ['init-env.sh'], {
    cwd: COMPOSE_DIR,
    timeoutMs: 30_000,
  })

  if (result.exitCode !== 0) return false
  if (clearDevSignIn()) pushEvent(compose, 'new secrets — cleared the old dev Desktop sign-in')

  return true
}

let images: Images = {}

const startDataStores = singleFlight(async (): Promise<LocalStack | null> => {
  const rows = [mongo, rustfs]

  if (!(await ensureComposeEnv())) {
    failRows(rows, 'init-env.sh failed', '')

    return null
  }
  const local = readLocalStack(COMPOSE_ENV)

  if (!local) {
    failRows(rows, 'deploy/compose/.env lacks generated secrets; delete it and rerun', '')

    return null
  }
  resetRow(mongo, `127.0.0.1:${String(local.mongoPort)}`)
  resetRow(rustfs, `http://127.0.0.1:${String(local.rustfsPort)}`)
  const found = await readImages()

  if (!found) {
    failRows(rows, 'docker compose config failed — is Docker running?', '')

    return null
  }
  images = found
  const pulled = await Promise.all(rows.map((row) => pullImage(row, images)))

  if (pulled.includes(false)) return null
  for (const row of rows) startTiming(row)
  setDownstreamNote(waitingNote(rows.map((row) => row.name)))
  const up = await docker(rows, [...COMPOSE, 'up', '-d', 'mongo', 'rustfs'], 300_000)

  if (!up.ok)
    pushEvent(
      compose,
      `docker compose up reported: ${up.tail}${staleHint(up.tail)} — checking each container`,
    )
  if (!(await watchStores(rows, up.tail))) return null
  setDownstreamNote(null)

  return local
})

export function startStack(): Promise<LocalStack | null> {
  return startDataStores()
}

export const startRuntimeContainer = singleFlight(async (): Promise<boolean> => {
  if (!(await pullImage(runtime, images))) return false
  startTiming(runtime)
  pushEvent(runtime, 'starting container …')
  const up = await docker([runtime], [...COMPOSE, 'up', '-d', 'runtime'], 300_000)

  if (!up.ok) failRows([runtime], `docker compose up runtime failed${staleHint(up.tail)}`, up.tail)

  return up.ok
})

/** `stop` keeps the volumes; `down` removes them with the containers, managed agents included. */
export async function stopStack(mode: 'stop' | 'down', onLine: (line: string) => void) {
  const args = mode === 'down' ? RESET_ARGS : ['stop']
  const result = await runDevCommand('docker', [...COMPOSE, ...args], {
    cwd: COMPOSE_DIR,
    timeoutMs: 120_000,
    onStdout: onLine,
    onStderr: onLine,
  })

  if (result.exitCode === 0 && mode === 'down' && clearDevSignIn())
    onLine('cleared the dev Desktop sign-in')
  await cleanupManagedAgents(mode, onLine)

  return result.exitCode === 0
}
