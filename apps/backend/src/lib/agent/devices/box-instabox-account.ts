// Which instabox account a Box's machine lives on: the deployment's, or one the
// team bound itself (`box.accountId`). A team's account is billed by instabox,
// so Nuphos's vCPU limit applies only to the deployment's (see startBox).

import { setTimeout as sleep } from 'node:timers/promises'

import { DEFAULT_API_URL } from '@insforge/instabox-sdk'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { decryptInstaboxSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models/team'

import {
  QUICK_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  RETRY_AFTER_MS,
  connection,
} from './box-instabox-client'

import type { AgentDeviceBox } from './store'
import type { InstaboxAccountBinding } from '@/models/bindings-integrations'

/** A size a Box can be started with. */
export type BoxSize = { vcpus: number; memMiB: number }
export type BoxAccountRef = Pick<AgentDeviceBox, 'teamId' | 'accountId'>
export type BoxConnection = ReturnType<typeof connection>

export async function findInstaboxAccount(
  teamId: string,
  accountId: string,
): Promise<InstaboxAccountBinding | null> {
  if (!ObjectId.isValid(teamId) || !ObjectId.isValid(accountId)) return null
  const doc = await teamByosBindings().findOne(
    { _id: new ObjectId(teamId) },
    { projection: { instaboxAccounts: 1 } },
  )

  return (doc?.instaboxAccounts ?? []).find((a) => a.id.toHexString() === accountId) ?? null
}

/** Connection options for the Box's account; a binding that is gone leaves its Box unreachable. */
export async function boxConnection(box: BoxAccountRef, timeoutMs: number): Promise<BoxConnection> {
  if (!box.accountId) return connection(timeoutMs)
  const account = await findInstaboxAccount(box.teamId, box.accountId)

  if (!account)
    throw new AppError(
      409,
      'box_unavailable',
      "This computer's instabox account is no longer connected to the team",
    )

  return {
    apiKey: decryptInstaboxSecret(account.encryptedApiKey),
    ...(config.box.instabox?.apiUrl ? { apiUrl: config.box.instabox.apiUrl } : {}),
    requestTimeoutMs: Math.min(timeoutMs, REQUEST_TIMEOUT_MS),
    operationTimeoutMs: timeoutMs,
  }
}

/**
 * The account, read again once on a reset connection or a 502–504, as the SDK reads its own.
 * Never after a timeout, which already waited its full budget.
 */
async function readMe(apiUrl: string, apiKey: string, retried = false): Promise<Response> {
  try {
    const response = await fetch(`${apiUrl}/v1/me`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
    })

    if (retried || response.status < 502 || response.status > 504) return response
  } catch (error) {
    if (retried || (error instanceof Error && error.name === 'TimeoutError')) throw error
  }
  await sleep(RETRY_AFTER_MS)

  return readMe(apiUrl, apiKey, true)
}

/** How long sizes read from an account are used before being read again. */
const SIZES_FRESH_MS = 10 * 60_000
const knownSizes = new Map<string, { sizes: BoxSize[]; readAt: number }>()

/**
 * The sizes an instabox key may start, smallest first: its account's `allowedSpecs`. They change
 * only with the account's plan, so a create uses those read in the last 10 minutes, and the last
 * known ones when reading them again fails. A key instabox refuses is refused.
 */
export async function accountSizes({
  apiKey,
  apiUrl = DEFAULT_API_URL,
}: {
  apiKey: string
  apiUrl?: string
}): Promise<BoxSize[]> {
  const key = `${apiUrl}\n${apiKey}`
  const known = knownSizes.get(key)

  if (known && Date.now() - known.readAt < SIZES_FRESH_MS) return known.sizes
  try {
    const sizes = await readSizes(apiUrl, apiKey)

    knownSizes.set(key, { sizes, readAt: Date.now() })

    return sizes
  } catch (error) {
    if (!known || error instanceof AppError) throw error

    return known.sizes
  }
}

async function readSizes(apiUrl: string, apiKey: string): Promise<BoxSize[]> {
  const response = await readMe(apiUrl, apiKey)

  if (response.status === 401 || response.status === 403)
    throw new AppError(400, 'invalid_instabox_api_key', 'The instabox API key is not valid')
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const { allowedSpecs = [] } = (await response.json()) as { allowedSpecs?: BoxSize[] }
  const sizes = allowedSpecs
    .map(({ vcpus, memMiB }) => ({ vcpus, memMiB }))
    .sort((a, b) => a.vcpus - b.vcpus)

  if (sizes.length === 0) throw new Error('the account allows no size')

  return sizes
}
