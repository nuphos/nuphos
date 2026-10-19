// A team's vCPU limit, applied where a Box starts: the vCPUs of its running Boxes,
// as instabox reports them, must stay within it. The limit is the team document's
// `boxVcpuLimit`, written by a separate billing service, else the deployment default.

import { randomUUID } from 'node:crypto'

import { DEFAULT_API_URL, Sandbox } from '@insforge/instabox-sdk'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { teams } from '@/lib/identity/shared'

import { QUICK_TIMEOUT_MS, connection, unavailable } from './box-instabox-client'
import { assertWithinLimit, isRunning, runningVcpus } from './box-vcpu'
import { teamOrderingVcpus } from './store'

/** A size a Box can be started with. */
export type BoxSize = { vcpus: number; memMiB: number }

/** The team's limit and whether its own document sets it; undefined limit is unlimited. */
export async function teamVcpuLimit(teamId: string) {
  const team = await teams().findOne(
    { _id: new ObjectId(teamId) },
    { projection: { boxVcpuLimit: 1 } },
  )
  const own = team?.boxVcpuLimit

  return { limit: own ?? config.box.defaultVcpuLimit, own: own !== undefined }
}

/** The team's machines with their states and sizes, as instabox knows them. */
async function teamMachines(teamId: string) {
  try {
    const machines = await Sandbox.list({ ...connection(QUICK_TIMEOUT_MS), metadata: { teamId } })

    return machines.map(({ sandboxId, state, machine }) => ({
      sandboxId,
      state,
      vcpus: machine.spec.vcpus,
    }))
  } catch (error) {
    throw unavailable("Could not read the team's Boxes", error)
  }
}

/** The sizes instabox lets this deployment's account start, smallest first: its `allowedSpecs`. */
export async function boxSizes(): Promise<BoxSize[]> {
  const { apiKey, apiUrl = DEFAULT_API_URL } = connection(QUICK_TIMEOUT_MS)

  try {
    const response = await fetch(`${apiUrl}/v1/me`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    const { allowedSpecs = [] } = (await response.json()) as { allowedSpecs?: BoxSize[] }
    const sizes = allowedSpecs
      .map(({ vcpus, memMiB }) => ({ vcpus, memMiB }))
      .sort((a, b) => a.vcpus - b.vcpus)

    if (sizes.length === 0) throw new Error('the account allows no size')

    return sizes
  } catch (error) {
    throw unavailable('Could not read the Box sizes', error)
  }
}

/** The size of `vcpus`, the smallest when unset; one instabox does not offer is refused. */
export async function boxSize(vcpus?: number): Promise<BoxSize> {
  const sizes = await boxSizes()
  const size = vcpus === undefined ? sizes[0] : sizes.find((s) => s.vcpus === vcpus)

  if (!size)
    throw new AppError(
      400,
      'box_size',
      `A Box comes with ${sizes.map((s) => String(s.vcpus)).join(' or ')} vCPU`,
    )

  return size
}

/** vCPUs the team's running Boxes use, Boxes still being ordered included. */
export async function teamBoxUsage(teamId: string) {
  const [machines, ordering] = await Promise.all([teamMachines(teamId), teamOrderingVcpus(teamId)])

  return { machines, usedVcpus: runningVcpus(machines) + ordering }
}

/** How long a start may hold the team's start lease if it never releases it. */
const LEASE_MS = 60_000
/** How long a start waits for another start in the same team. */
const LEASE_WAIT_MS = 10_000

async function acquireStartLease(teamId: string): Promise<string | null> {
  const token = randomUUID()
  const deadline = Date.now() + LEASE_WAIT_MS

  do {
    const now = new Date()
    const result = await teams().updateOne(
      { _id: new ObjectId(teamId), $nor: [{ 'boxStartLease.until': { $gt: now } }] },
      { $set: { boxStartLease: { token, until: new Date(now.getTime() + LEASE_MS) } } },
    )

    if (result.matchedCount > 0) return token
    await new Promise((resolve) => setTimeout(resolve, 500))
  } while (Date.now() < deadline)

  return null
}

/**
 * Starts a Box, a new one of `vcpus` or the existing `sandboxId`, only within the team's
 * limit. One start per team at a time: the check and the start are not atomic, so two
 * starts must not race.
 */
export async function startWithinLimit<T>(
  teamId: string,
  starting: { vcpus: number } | { sandboxId: string },
  start: () => Promise<T>,
): Promise<T> {
  const { limit } = await teamVcpuLimit(teamId)

  if (limit === undefined) return start()
  const token = await acquireStartLease(teamId)

  if (!token)
    throw new AppError(409, 'box_starting', 'Another Box in this team is starting; try again')
  try {
    const { machines, usedVcpus } = await teamBoxUsage(teamId)
    // A machine already running, or gone, starts nothing new.
    const vcpus =
      'vcpus' in starting
        ? starting.vcpus
        : machines.find((m) => m.sandboxId === starting.sandboxId && !isRunning(m.state))?.vcpus

    if (vcpus !== undefined) assertWithinLimit(limit, usedVcpus, vcpus)

    return await start()
  } finally {
    // Only our own lease: one that expired may already be someone else's.
    await teams().updateOne(
      { _id: new ObjectId(teamId), 'boxStartLease.token': token },
      { $unset: { boxStartLease: '' } },
    )
  }
}

/** What the Boxes section shows: use against the limit, the sizes to choose from, and where to upgrade. */
export async function boxUsageView(teamId: string) {
  const { limit, own } = await teamVcpuLimit(teamId)
  // An instabox outage leaves usage and sizes unknown rather than failing the read.
  const [usage, sizes] = config.box.instabox
    ? await Promise.all([
        limit !== undefined ? teamBoxUsage(teamId).catch(() => null) : null,
        boxSizes().catch(() => []),
      ])
    : [null, []]

  return {
    /** Null when unlimited. */
    limitVcpus: limit ?? null,
    /** Whether the limit comes from the team's own subscription. */
    subscribed: own,
    usedVcpus: usage?.usedVcpus ?? null,
    /** A new Box's default size: the smallest. Kept for Desktops that predate `sizes`. */
    boxVcpus: sizes[0]?.vcpus ?? null,
    /** The sizes a new Box can have, smallest first. */
    sizes,
    /** Every Box of the team with its own size; `running` ones count against the limit. */
    boxes: (usage?.machines ?? [])
      .filter((machine) => machine.state !== 'deleted')
      .map(({ sandboxId, state, vcpus }) => ({ sandboxId, vcpus, running: isRunning(state) })),
    billingUrl: config.box.billingUrl ?? null,
  }
}
