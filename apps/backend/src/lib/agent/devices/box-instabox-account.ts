// Which instabox account a Box's machine lives on: the deployment's, or one the
// team bound itself (`box.accountId`). A team's account is billed by instabox,
// so Nuphos's vCPU limit applies only to the deployment's (see startBox).

import { setTimeout as sleep } from 'node:timers/promises'

import { DEFAULT_API_URL } from '@insforge/instabox-sdk'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { decryptInstaboxSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
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
export type BoxConnection = ReturnType<typeof connection> & { fetch?: typeof fetch }

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
    fetch: watchKey(box.teamId, account),
  }
}

/**
 * Every call with a team's key records on its binding whether instabox took the key, so the
 * team's admins see a rejected one in Integrations. Written only when that changes.
 */
function watchKey(teamId: string, account: InstaboxAccountBinding): typeof fetch {
  let rejected = Boolean(account.keyRejectedAt)

  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await fetch(input, init)
    const now = await keyRejected(response)

    if (now !== undefined && now !== rejected) {
      rejected = now
      await teamByosBindings()
        .updateOne(
          { _id: new ObjectId(teamId), 'instaboxAccounts.id': account.id },
          now
            ? { $set: { 'instaboxAccounts.$.keyRejectedAt': new Date() } }
            : { $unset: { 'instaboxAccounts.$.keyRejectedAt': '' } },
        )
        .catch((error: unknown) => {
          logError('agent.box.instabox_key_mark_failed', error)
        })
    }

    return response
  }) as typeof fetch
}

/** Whether a response says instabox refused the key; undefined when it says neither. */
async function keyRejected(response: Response): Promise<boolean | undefined> {
  if (response.ok) return false
  if (response.status === 401) return true
  if (response.status !== 403) return undefined
  // A 403 also refuses a size the plan does not allow, which is not about the key.
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: unknown } } | null

  return body?.error?.code !== 'spec_not_allowed'
}

/**
 * The account, read again once on a reset connection or a 502–504, as the SDK reads its own.
 * Never after a timeout, which already waited its full budget.
 */
async function readMe(
  apiUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  retried = false,
): Promise<Response> {
  try {
    const response = await fetchImpl(`${apiUrl}/v1/me`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
    })

    if (retried || response.status < 502 || response.status > 504) return response
  } catch (error) {
    if (retried || (error instanceof Error && error.name === 'TimeoutError')) throw error
  }
  await sleep(RETRY_AFTER_MS)

  return readMe(apiUrl, apiKey, fetchImpl, true)
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
  fetch: fetchImpl = fetch,
}: {
  apiKey: string
  apiUrl?: string
  fetch?: typeof fetch
}): Promise<BoxSize[]> {
  const key = `${apiUrl}\n${apiKey}`
  const known = knownSizes.get(key)

  if (known && Date.now() - known.readAt < SIZES_FRESH_MS) return known.sizes
  try {
    const sizes = await readSizes(apiUrl, apiKey, fetchImpl)

    knownSizes.set(key, { sizes, readAt: Date.now() })

    return sizes
  } catch (error) {
    if (!known || error instanceof AppError) throw error
    // Tried for the next 10 minutes too, so an outage costs one create a wait, not every one.
    known.readAt = Date.now()

    return known.sizes
  }
}

async function readSizes(
  apiUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<BoxSize[]> {
  const response = await readMe(apiUrl, apiKey, fetchImpl)

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
