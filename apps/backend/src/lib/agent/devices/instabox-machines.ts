// The instabox calls the provider makes without keeping a Sandbox object, as plain
// functions so a test can stand them in (the SDK exports a class, which the
// shared doubles cannot wrap).

import { DEFAULT_API_URL, InstaboxError, Sandbox } from '@insforge/instabox-sdk'

import type { ConnectionOptions } from '@insforge/instabox-sdk'

/** A machine's size and disk as instabox reports them. */
export type MachineSize = { state: string; vcpus: number; memMiB: number; diskGiB: number }
/** What a resize changes; the disk only grows. */
export type MachineResize = { vcpus?: number; memMiB?: number; diskGiB?: number }

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

/** The machine's state, size and `/data` disk, without waking a paused one. */
export async function machineSize(
  conn: ConnectionOptions,
  sandboxId: string,
): Promise<MachineSize> {
  const sandbox = await Sandbox.connect(sandboxId, { ...conn, resume: false })
  const { state, machine } = await sandbox.getInfo()

  return {
    state,
    vcpus: machine.spec.vcpus,
    memMiB: machine.spec.memMiB,
    diskGiB: machine.spec.persistentDiskGiB,
  }
}

/** Stops the machine: its processes end, its disks stay. */
export async function stopMachine(conn: ConnectionOptions, sandboxId: string): Promise<void> {
  await (await Sandbox.connect(sandboxId, { ...conn, resume: false })).stop()
}

/**
 * Gives a stopped machine another size or a bigger `/data`, which apply at its next start.
 * Not in this SDK yet, so it is the API's own PATCH; instabox grows the filesystem itself.
 */
export async function resizeMachine(
  conn: ConnectionOptions,
  sandboxId: string,
  { vcpus, memMiB, diskGiB }: MachineResize,
): Promise<void> {
  const response = await fetch(
    `${conn.apiUrl ?? DEFAULT_API_URL}/v1/machines/${encodeURIComponent(sandboxId)}`,
    {
      method: 'PATCH',
      headers: { 'X-API-Key': conn.apiKey ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ vcpus, memMiB, persistentDiskGiB: diskGiB }),
      signal: AbortSignal.timeout(conn.requestTimeoutMs ?? 15_000),
    },
  )

  if (response.ok) return
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string }
  } | null

  throw new InstaboxError(body?.error?.message ?? `HTTP ${String(response.status)}`, {
    status: response.status,
    code: body?.error?.code ?? `http_${String(response.status)}`,
  })
}
