// What a client sees of a Box's machine. Nothing is stored: the device's
// presence says running, and instabox says the rest.

import { InstaboxError, Sandbox } from '@insforge/instabox-sdk'

import { connection } from './box-instabox-client'

import type { AgentDevice } from './store'

/** `error` means instabox could not say; `gone` that it no longer has the machine. */
export type BoxState = 'creating' | 'running' | 'paused' | 'error'

/** A state read for a listing: an outage must not stall the devices page. */
const READ_TIMEOUT_MS = 5_000
/** How long a state read is reused by the clients polling the list. */
const STATE_CACHE_MS = 5_000

const stateReads = new Map<string, { at: number; read: Promise<BoxState | 'gone'> }>()

/**
 * The machine's state as instabox reports it, for a Box that is not present.
 * `gone` means instabox no longer has the machine, so the row should go too.
 * Clients poll, so one read per machine is shared for a few seconds.
 */
export async function boxState(device: AgentDevice, online: boolean): Promise<BoxState | 'gone'> {
  // No machine yet, or a machine whose host has never joined: still setting up.
  if (!device.box?.sandboxId || !device.credentialHash) return 'creating'
  if (online) return 'running'
  const { sandboxId } = device.box
  const cached = stateReads.get(sandboxId)

  if (cached && Date.now() - cached.at < STATE_CACHE_MS) return cached.read
  const read = readMachineState(sandboxId)

  stateReads.set(sandboxId, { at: Date.now(), read })

  return read
}

async function readMachineState(sandboxId: string): Promise<BoxState | 'gone'> {
  try {
    const sandbox = await Sandbox.connect(sandboxId, {
      ...connection(READ_TIMEOUT_MS),
      resume: false,
    })
    const { state } = await sandbox.getInfo()

    return state === 'running' || state === 'starting' ? 'running' : 'paused'
  } catch (error) {
    // Only the machine lookup itself answers 404 here; a wrong API URL fails earlier and differently.
    return error instanceof InstaboxError && error.status === 404 ? 'gone' : 'error'
  }
}
