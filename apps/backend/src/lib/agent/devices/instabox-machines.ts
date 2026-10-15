// The two instabox calls the provider makes without a Sandbox object, as plain
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
