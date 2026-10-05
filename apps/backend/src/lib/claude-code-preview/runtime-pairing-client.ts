import { AppError } from '@/lib/errors'

import { isAllowedRemoteOpenAbUrl } from './runtime-backend-url'
import { isOpenAbProvider } from './runtime-provider'
import { storedAuthKey } from './runtime-registry-credentials'

import type { OpenAbProvider } from './runtime-provider'
import type { EncryptedEnvelope } from '@/models'

const PAIRING_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 16 * 1024

export const PAIRING_CODE_PATTERN = /^[A-Z2-7]{26}$/u

export type RuntimePairing = {
  bindingId: string
  runtimeInstanceId: string
  pairedAt: Date
  pairedByUserId: string
}

export type PairingClientMetadata = {
  backendOrigin: string
  teamId: string
  teamName: string
  pairedBy: string
  runtimeRecordId: string
}

export type PairingExchange = {
  bindingId: string
  transportKey: string
  controlKey: string
  runtimeInstanceId: string
  provider?: OpenAbProvider
  pendingUntil?: string
}

export type BindingStatus = 'active' | 'pending' | 'revoked' | 'unknown'

type Fetch = typeof fetch

/** Accepts what a runtime console hands out (http(s) or ws(s), with or without `/acp`)
 *  and returns the ACP URL Nuphos stores and dials. */
export function normalizePairingRuntimeUrl(value: string): string | null {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  const protocol = { 'https:': 'wss:', 'http:': 'ws:', 'wss:': 'wss:', 'ws:': 'ws:' }[url.protocol]

  if (!protocol || url.username || url.password) return null
  const path =
    url.pathname === '/' || url.pathname === '' ? '/acp' : url.pathname.replace(/\/$/u, '')
  const normalized = `${protocol}//${url.host}${path}`

  return isAllowedRemoteOpenAbUrl(normalized) ? normalized : null
}

export function pairingHttpBase(acpUrl: string): string | null {
  if (!isAllowedRemoteOpenAbUrl(acpUrl)) return null
  try {
    const url = new URL(acpUrl)

    return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
  } catch {
    return null
  }
}

async function readCapped(response: Response): Promise<unknown> {
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined

  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('runtime response too large')
    }
    chunks.push(value)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks))

  return text ? (JSON.parse(text) as unknown) : null
}

async function request(
  fetchImpl: Fetch,
  acpUrl: string,
  path: string,
  init: { method: 'GET' | 'POST'; bearer?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const base = pairingHttpBase(acpUrl)

  if (!base)
    throw new AppError(
      422,
      'invalid_runtime_url',
      'Agent URL must be wss://, or ws:// on a *.svc cluster-internal host.',
    )
  const response = await fetchImpl(`${base}${path}`, {
    method: init.method,
    redirect: 'manual',
    signal: AbortSignal.timeout(PAIRING_TIMEOUT_MS),
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  return { status: response.status, body: await readCapped(response).catch(() => null) }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseExchange(body: unknown): PairingExchange | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const bindingId = str(record.bindingId)
  const transportKey = str(record.transportKey)
  const controlKey = str(record.controlKey)
  const runtimeInstanceId = str(record.runtimeInstanceId)

  if (!bindingId || !transportKey || !controlKey || !runtimeInstanceId) return null
  const provider = str(record.provider)
  const pendingUntil = str(record.pendingUntil)

  return {
    bindingId,
    transportKey,
    controlKey,
    runtimeInstanceId,
    ...(isOpenAbProvider(provider) ? { provider } : {}),
    ...(pendingUntil ? { pendingUntil } : {}),
  }
}

const unreachable = () =>
  new AppError(
    502,
    'runtime_unreachable',
    'Nuphos could not reach this agent to finish connecting. Check that its address is reachable from Nuphos, then generate a new pairing code.',
  )

export async function exchangePairingCode(
  acpUrl: string,
  code: string,
  client: PairingClientMetadata,
  fetchImpl: Fetch = fetch,
): Promise<PairingExchange> {
  let result: { status: number; body: unknown }

  try {
    result = await request(fetchImpl, acpUrl, '/_openab/pairing/exchange', {
      method: 'POST',
      body: { code, client },
    })
  } catch (err) {
    if (err instanceof AppError) throw err
    throw unreachable()
  }
  if (result.status === 429)
    throw new AppError(
      429,
      'runtime_pairing_rate_limited',
      'The agent is refusing pairing attempts for a moment. Wait a minute, then generate a new code.',
    )
  if (result.status >= 400 && result.status < 500)
    throw new AppError(
      422,
      'pairing_code_rejected',
      'The agent rejected this pairing code. It may have expired or already been used, or the agent image may predate one-click connect. Generate a new code in the agent console.',
    )
  const exchange = result.status >= 200 && result.status < 300 ? parseExchange(result.body) : null

  if (!exchange) throw unreachable()

  return exchange
}

export async function revokeBinding(
  acpUrl: string,
  controlKey: string,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  try {
    const { status } = await request(fetchImpl, acpUrl, '/_openab/bindings/self/revoke', {
      method: 'POST',
      bearer: controlKey,
    })

    return (status >= 200 && status < 300) || status === 401
  } catch {
    return false
  }
}

export async function bindingStatus(
  acpUrl: string,
  key: string,
  fetchImpl: Fetch = fetch,
): Promise<BindingStatus> {
  try {
    const { status, body } = await request(fetchImpl, acpUrl, '/_openab/bindings/self', {
      method: 'GET',
      bearer: key,
    })

    if (status === 401) return 'revoked'
    if (status < 200 || status >= 300) return 'unknown'
    const state = (body as { state?: unknown } | null)?.state

    return state === 'active' || state === 'pending' ? state : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Best effort: an unreachable runtime keeps a binding nobody holds the keys to any more. */
export async function revokePairedBinding(
  doc: { url: string; pairing?: RuntimePairing; controlKeyEnvelope?: EncryptedEnvelope },
  fetchImpl: Fetch = fetch,
): Promise<void> {
  const controlKey = doc.pairing ? storedAuthKey(doc.controlKeyEnvelope) : null

  if (controlKey) await revokeBinding(doc.url, controlKey, fetchImpl)
}
