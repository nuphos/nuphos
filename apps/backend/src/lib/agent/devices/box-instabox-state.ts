// What a client sees of a Box's machine. Nothing is stored: the device's
// presence says running, and instabox says the rest.

import { setTimeout as sleep } from 'node:timers/promises'

import { InstaboxError } from '@insforge/instabox-sdk'

import { logEvent } from '@/lib/observability'

import { boxConnection } from './box-instabox-account'
import { lastPausedBy, machineState } from './instabox-machines'

import type { AgentDevice, AgentDeviceBox } from './store'

/** `error` means instabox could not say; `gone` that it no longer has the machine. */
/** `connecting`: the machine runs but its host has not joined yet. */
export type BoxState = 'creating' | 'connecting' | 'running' | 'paused' | 'error'

/** A state read for a listing: an outage must not stall the devices page. */
const READ_TIMEOUT_MS = 5_000
/** How long a state read is reused by the clients polling the list. */
const STATE_CACHE_MS = 5_000

const stateReads = new Map<string, { at: number; read: Promise<BoxState | 'gone'> }>()
const pauseReads = new Map<string, { at: number; read: Promise<string | undefined> }>()

/** One read per machine, shared by every client polling within a few seconds. */
function shared<T>(
  reads: Map<string, { at: number; read: Promise<T> }>,
  sandboxId: string,
  read: () => Promise<T>,
): Promise<T> {
  const cached = reads.get(sandboxId)

  if (cached && Date.now() - cached.at < STATE_CACHE_MS) return cached.read
  const fresh = read()

  reads.set(sandboxId, { at: Date.now(), read: fresh })

  return fresh
}

/**
 * The machine's state as instabox reports it, for a Box that is not present.
 * `gone` means instabox no longer has the machine, so the row should go too.
 * Clients poll, so one read per machine is shared for a few seconds.
 */
export async function boxState(device: AgentDevice, online: boolean): Promise<BoxState | 'gone'> {
  const box = device.box
  const sandboxId = box?.sandboxId

  if (!box || !sandboxId) return 'creating'
  if (online) return 'running'
  const state = await shared(stateReads, sandboxId, () => readMachineState(box, sandboxId))

  // A running machine whose host has never joined is waiting for it, not offline.
  return state === 'running' && !device.lastSeenAt ? 'connecting' : state
}

/**
 * The read gets its budget as a whole: the SDK retries each of its requests, timed out ones
 * included, so the request timeout alone let one read run for most of a minute.
 */
function readMachineState(box: AgentDeviceBox, sandboxId: string) {
  return Promise.race([
    readMachineStateOnce(box, sandboxId),
    sleep(READ_TIMEOUT_MS, 'error' as const, { ref: false }),
  ])
}

async function readMachineStateOnce(box: AgentDeviceBox, sandboxId: string) {
  try {
    const state = await machineState(await boxConnection(box, READ_TIMEOUT_MS), sandboxId)

    return state === 'running' || state === 'starting' ? 'running' : 'paused'
  } catch (error) {
    // Only the machine lookup itself answers 404 here; a wrong API URL fails earlier and differently.
    return error instanceof InstaboxError && error.status === 404 ? 'gone' : 'error'
  }
}

/** For a paused Box: why instabox paused it on its own, such as `memory_pressure`; else undefined. */
export async function boxPausedBy(device: AgentDevice): Promise<string | undefined> {
  const box = device.box
  const sandboxId = box?.sandboxId

  if (!box || !sandboxId) return undefined

  return shared(pauseReads, sandboxId, async () =>
    lastPausedBy(await boxConnection(box, READ_TIMEOUT_MS), sandboxId).catch(() => undefined),
  )
}

/**
 * A Box's tunnel closed: when instabox paused the machine itself (its host ran out of memory, …)
 * and not on anyone's request, that is logged as `agent.box.evicted`. The Box wakes on next use.
 */
export async function noteBoxEviction(
  userId: string,
  deviceId: string,
  getDevice: (userId: string, deviceId: string) => Promise<AgentDevice | null>,
): Promise<void> {
  const device = await getDevice(userId, deviceId).catch(() => null)
  const sandboxId = device?.box?.sandboxId
  const trigger = device && (await boxPausedBy(device))

  if (!sandboxId || !trigger) return
  logEvent('warn', 'agent.box.evicted', {
    trigger,
    machine_id: sandboxId,
    ...(device.box?.teamId ? { team_id: device.box.teamId } : {}),
    user_id: userId,
    device_id: deviceId,
  })
}
