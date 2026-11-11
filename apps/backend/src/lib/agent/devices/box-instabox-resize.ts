// Resizing a Box: another of its account's sizes, a bigger /data, or both. instabox resizes
// a machine only while it is stopped, so a running Box is stopped, resized and started again:
// its files stay, its processes and agent turns end. Checked here, then run in the background.

import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { resumeBox } from './box-instabox'
import { boxConnection } from './box-instabox-account'
import { QUICK_TIMEOUT_MS, reason, unavailable } from './box-instabox-client'
import { boxSize, boxSizes, teamBoxUsage, teamVcpuLimit } from './box-instabox-limit'
import { endBoxResize, markBoxResizeStarted } from './box-resizing'
import { boxUpdatingSince } from './box-updating'
import { noteBoxUsage } from './box-usage-history'
import { assertWithinLimit, isRunning } from './box-vcpu'
import { machineSize, resizeMachine, stopMachine } from './instabox-machines'
import { getAgentDevice } from './store'

import type { BoxSize } from './box-instabox-account'
import type { MachineResize, MachineSize } from './instabox-machines'
import type { AgentDevice, AgentDeviceBox } from './store'

/** The largest `/data` instabox makes; a plan may cap it lower, which its refusal says. */
export const MAX_BOX_DISK_GIB = 1024
/** Stopping the machine and resizing it, in the background. */
const RESIZE_TIMEOUT_MS = 3 * 60_000

type InstaboxBox = AgentDevice & { box: AgentDeviceBox & { sandboxId: string } }

export type BoxSizeView = {
  vcpus: number
  memMiB: number
  diskGiB: number
  /** Whether it runs now, so a resize restarts it. */
  running: boolean
  /** The sizes its account offers, smallest first. */
  sizes: BoxSize[]
  maxDiskGiB: number
}

async function requireInstaboxBox(userId: string, deviceId: string): Promise<InstaboxBox> {
  const device = await getAgentDevice(userId, deviceId)

  if (device?.box?.provider !== 'instabox')
    throw new AppError(404, 'not_found', `No Box ${deviceId}`)
  if (!device.box.sandboxId) throw new AppError(409, 'box_state', 'The Box is still being created')

  return device as InstaboxBox
}

async function readSize(device: InstaboxBox): Promise<MachineSize> {
  try {
    return await machineSize(
      await boxConnection(device.box, QUICK_TIMEOUT_MS),
      device.box.sandboxId,
    )
  } catch (error) {
    if (error instanceof AppError) throw error
    throw unavailable("Could not read the Box's size", error)
  }
}

/** The Box's size and disk now, and what it may be resized to. */
export async function boxSizeView(userId: string, deviceId: string): Promise<BoxSizeView> {
  const device = await requireInstaboxBox(userId, deviceId)
  const [size, sizes] = await Promise.all([readSize(device), boxSizes(device.box)])

  return {
    vcpus: size.vcpus,
    memMiB: size.memMiB,
    diskGiB: size.diskGiB,
    running: isRunning(size.state),
    sizes,
    maxDiskGiB: MAX_BOX_DISK_GIB,
  }
}

/** What actually changes; the disk is refused when asked to shrink. */
async function resizeChange(
  device: InstaboxBox,
  current: MachineSize,
  { vcpus, diskGiB }: { vcpus?: number; diskGiB?: number },
): Promise<MachineResize> {
  if (diskGiB !== undefined && diskGiB < current.diskGiB)
    throw new AppError(
      400,
      'box_disk_shrink',
      `A Box's disk only grows; this one has ${String(current.diskGiB)} GB`,
    )
  const size = vcpus === undefined ? undefined : await boxSize(vcpus, device.box)
  const change: MachineResize = {
    ...(size && (size.vcpus !== current.vcpus || size.memMiB !== current.memMiB) ? size : {}),
    ...(diskGiB !== undefined && diskGiB > current.diskGiB ? { diskGiB } : {}),
  }

  if (Object.keys(change).length === 0)
    throw new AppError(400, 'box_resize_unchanged', 'The Box already has this size')

  return change
}

/** A running Box on the deployment's account comes back bigger only within the team's limit. */
async function assertFitsLimit(box: AgentDeviceBox, current: MachineSize, vcpus?: number) {
  if (box.accountId || vcpus === undefined || vcpus <= current.vcpus) return
  if (!isRunning(current.state)) return // it starts at the new size on its next resume, checked then
  const { limit } = await teamVcpuLimit(box.teamId)

  if (limit === undefined) return
  const { usedVcpus } = await teamBoxUsage(box.teamId)

  assertWithinLimit(box.teamId, limit, usedVcpus - current.vcpus, vcpus)
}

/**
 * Starts resizing the Box and returns it marked as resizing. A Box that ran is started again
 * at the new size; a paused one stays stopped and takes it at its next resume.
 */
export async function resizeBox(
  userId: string,
  deviceId: string,
  requested: { vcpus?: number; diskGiB?: number },
): Promise<AgentDevice> {
  const device = await requireInstaboxBox(userId, deviceId)

  if (boxUpdatingSince(device))
    throw new AppError(409, 'box_updating', 'The Box is updating; resize it once it is back.')
  const current = await readSize(device)
  const change = await resizeChange(device, current, requested)

  await assertFitsLimit(device.box, current, change.vcpus)
  const startedAt = new Date()

  if (!(await markBoxResizeStarted(userId, deviceId, startedAt)))
    throw new AppError(409, 'box_resizing', 'The Box is already being resized')
  void runResize(device, current, change)

  return { ...device, box: { ...device.box, resize: { startedAt } } }
}

async function runResize(device: InstaboxBox, current: MachineSize, change: MachineResize) {
  const { userId, deviceId, box } = device
  const restart = isRunning(current.state)
  let failure: string | undefined

  try {
    const conn = await boxConnection(box, RESIZE_TIMEOUT_MS)

    if (current.state !== 'stopped') await stopMachine(conn, box.sandboxId)
    await resizeMachine(conn, box.sandboxId, change)
    logEvent('info', 'agent.box.resized', { user_id: userId, device_id: deviceId, ...change })
  } catch (error) {
    logError('agent.box.resize_failed', error, { user_id: userId, device_id: deviceId })
    failure = `Could not resize the Box: ${reason(error)}`
  }
  // The resize is over before the start, which a resize in progress would refuse.
  await endResize(userId, deviceId, failure)
  // Back up, at the new size or after a failure at the old one.
  if (restart) await startAgain(userId, deviceId, failure)
  noteBoxUsage(box.teamId)
}

async function endResize(userId: string, deviceId: string, failure?: string) {
  await endBoxResize(userId, deviceId, failure).catch((error: unknown) => {
    logError('agent.box.resize_end_failed', error, { user_id: userId, device_id: deviceId })
  })
}

/** Starts the Box again; a start that fails is the resize's failure when it had none. */
async function startAgain(userId: string, deviceId: string, failure?: string) {
  try {
    await resumeBox(userId, deviceId)
  } catch (error) {
    logError('agent.box.resize_restart_failed', error, { user_id: userId, device_id: deviceId })
    await endResize(userId, deviceId, failure ?? `The Box did not start again: ${reason(error)}`)
  }
}
