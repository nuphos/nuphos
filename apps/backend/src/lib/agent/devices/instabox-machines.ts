// The instabox calls the provider makes without keeping a Sandbox object, as plain
// functions so a test can stand them in (the SDK exports a class, which the
// shared doubles cannot wrap).

import { Sandbox } from '@insforge/instabox-sdk'

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
