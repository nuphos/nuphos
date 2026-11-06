// Which instabox account a Box's machine lives on: the deployment's, or one the
// team bound itself (`box.accountId`). A team's account is billed by instabox,
// so Nuphos's vCPU limit applies only to the deployment's (see startBox).

import { DEFAULT_API_URL } from '@insforge/instabox-sdk'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { decryptInstaboxSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models/team'

import { QUICK_TIMEOUT_MS, REQUEST_TIMEOUT_MS, connection } from './box-instabox-client'

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
    throw new AppError(409, 'box_unavailable', "The Box's instabox account is no longer bound")

  return {
    apiKey: decryptInstaboxSecret(account.encryptedApiKey),
    ...(config.box.instabox?.apiUrl ? { apiUrl: config.box.instabox.apiUrl } : {}),
    requestTimeoutMs: Math.min(timeoutMs, REQUEST_TIMEOUT_MS),
    operationTimeoutMs: timeoutMs,
  }
}

/** The sizes an instabox key may start, smallest first: its account's `allowedSpecs`. */
export async function accountSizes({
  apiKey,
  apiUrl = DEFAULT_API_URL,
}: {
  apiKey: string
  apiUrl?: string
}): Promise<BoxSize[]> {
  const response = await fetch(`${apiUrl}/v1/me`, {
    headers: { 'X-API-Key': apiKey },
    signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
  })

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
