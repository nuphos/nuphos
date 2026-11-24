// The instabox calls the provider makes without keeping a Sandbox object, as plain
// functions so a test can stand them in (the SDK exports a class, which the
// shared doubles cannot wrap).

import { DEFAULT_API_URL, Sandbox } from '@insforge/instabox-sdk'

import type { ConnectionOptions } from '@insforge/instabox-sdk'

/** The machines whose metadata carries every given key and value. */
export async function listMachines(
  conn: ConnectionOptions,
  metadata: Record<string, string>,
): Promise<{ sandboxId: string }[]> {
  return Sandbox.list({ ...conn, metadata })
}

/** Deletes the machine and its disks. */
export async function killMachine(conn: ConnectionOptions, sandboxId: string): Promise<void> {
  await Sandbox.kill(sandboxId, conn)
}

/** The machine's state as instabox reports it, without waking a paused one. */
export async function machineState(conn: ConnectionOptions, sandboxId: string): Promise<string> {
  const sandbox = await Sandbox.connect(sandboxId, { ...conn, resume: false })

  return (await sandbox.getInfo()).state
}

/** Runs a command on a running machine and returns its stdout; a paused one is not woken. */
export async function runOnRunningMachine(
  conn: ConnectionOptions,
  sandboxId: string,
  cmd: string,
  envs: Record<string, string>,
): Promise<string | undefined> {
  const sandbox = await Sandbox.connect(sandboxId, { ...conn, resume: false })

  if ((await sandbox.getInfo()).state !== 'running') return undefined

  return (await sandbox.commands.run(cmd, { envs, timeoutMs: 60_000 })).stdout
}

/** A read of instabox's API that the SDK has no call for. */
async function instaboxGet<T>(conn: ConnectionOptions, path: string): Promise<T> {
  const url = `${conn.apiUrl ?? DEFAULT_API_URL}${path}`
  const response = await (conn.fetch ?? fetch)(url, {
    headers: { 'X-API-Key': conn.apiKey ?? '' },
    signal: AbortSignal.timeout(conn.requestTimeoutMs ?? 10_000),
  })

  if (!response.ok) throw new Error(`instabox answered ${String(response.status)} for ${url}`)

  return (await response.json()) as T
}

/**
 * Why instabox itself paused or stopped the machine last (`memory_pressure`, `idle`, …), from
 * its operation log; undefined when a client asked for it or it ran again since.
 */
export async function lastPausedBy(
  conn: ConnectionOptions,
  sandboxId: string,
): Promise<string | undefined> {
  const { operations } = await instaboxGet<{
    operations?: { type: string; state: string; trigger?: string | null }[]
  }>(conn, `/v1/machines/${encodeURIComponent(sandboxId)}/logs?tail=1`)
  const last = operations?.at(-1)

  return (last?.type === 'suspend' || last?.type === 'stop') && last.state === 'succeeded'
    ? (last.trigger ?? undefined)
    : undefined
}

/** A machine using this share of its CPU or memory has none left for its host to answer with. */
const FULL = 0.95

/**
 * What the machine has run out of, from the latest of the samples instabox keeps (about five
 * minutes, taken outside the machine, so they go on while its own tunnel is down). Undefined
 * when it has headroom or there is no sample.
 */
export async function machinePressure(
  conn: ConnectionOptions,
  sandboxId: string,
): Promise<{ cpu: boolean; memory: boolean } | undefined> {
  const { metrics } = await instaboxGet<{
    metrics?: { cpuUsedPct?: number; memUsed?: number; memTotal?: number }[]
  }>(conn, `/v1/machines/${encodeURIComponent(sandboxId)}/metrics`)
  const last = metrics?.at(-1)

  if (!last) return undefined
  const cpu = (last.cpuUsedPct ?? 0) >= FULL * 100
  const memory = Boolean(last.memTotal) && (last.memUsed ?? 0) / (last.memTotal ?? 1) >= FULL

  return cpu || memory ? { cpu, memory } : undefined
}
