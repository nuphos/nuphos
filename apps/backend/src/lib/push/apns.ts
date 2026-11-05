import { createPrivateKey, sign } from 'node:crypto'
import { connect, constants } from 'node:http2'

import { config } from '@/config'
import { logEvent } from '@/lib/observability'

import type { ClientHttp2Session } from 'node:http2'

export type ApnsEnvironment = 'sandbox' | 'production'

export type ApnsCredentials = {
  keyId: string
  teamId: string
  bundleId: string
  privateKey: string
  environment: ApnsEnvironment
}

export type ApnsRequest = {
  deviceToken: string
  environment: ApnsEnvironment
  payload: Record<string, unknown>
  collapseId?: string
  /** Live Activity updates go to the activity's own token under their own topic. */
  pushType?: 'alert' | 'liveactivity'
}

export type ApnsResponse = { status: number; reason?: string }

export type ApnsTransport = (
  host: string,
  headers: Record<string, string>,
  body: string,
) => Promise<ApnsResponse>

const HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

// Apple rejects provider tokens older than an hour and throttles ones
// refreshed more often than every 20 minutes.
const JWT_TTL_MS = 45 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

// mutable-content hands the alert to the iOS extension that shows the Agent's avatar.
export const SESSION_ALERT_APS = { sound: 'default', category: 'REPLY', 'mutable-content': 1 }

export function apnsCredentials(): ApnsCredentials | null {
  const { keyId, teamId, bundleId, privateKey, environment } = config.apns

  if (!keyId || !teamId || !bundleId || !privateKey) return null

  return { keyId, teamId, bundleId, privateKey, environment }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

export function signProviderToken(credentials: ApnsCredentials, nowMs: number): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: credentials.keyId }))
  const claims = base64url(
    JSON.stringify({ iss: credentials.teamId, iat: Math.floor(nowMs / 1000) }),
  )
  const signingInput = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(credentials.privateKey),
    dsaEncoding: 'ieee-p1363',
  })

  return `${signingInput}.${base64url(signature)}`
}

let cachedToken: { value: string; keyId: string; issuedAt: number } | null = null

function providerToken(credentials: ApnsCredentials, nowMs: number): string {
  if (cachedToken?.keyId === credentials.keyId && nowMs - cachedToken.issuedAt < JWT_TTL_MS) {
    return cachedToken.value
  }
  const value = signProviderToken(credentials, nowMs)

  cachedToken = { value, keyId: credentials.keyId, issuedAt: nowMs }

  return value
}

const sessions = new Map<string, ClientHttp2Session>()

function http2Session(host: string): ClientHttp2Session {
  const existing = sessions.get(host)

  if (existing && !existing.closed && !existing.destroyed) return existing
  const session = connect(host)
  const drop = () => {
    if (sessions.get(host) === session) sessions.delete(host)
  }

  session.on('error', drop)
  session.on('close', drop)
  session.on('goaway', drop)
  session.unref()
  sessions.set(host, session)

  return session
}

/** A connection that refused a stream is likely to refuse the next one, so a
 *  retry dials again instead of reusing it. The old session is closed, not
 *  destroyed: a sibling push already sending on it must finish. */
function resetSession(host: string): void {
  const session = sessions.get(host)

  if (!session) return
  sessions.delete(host)
  session.close()
}

const http2Transport: ApnsTransport = (host, headers, body) =>
  new Promise((resolve, reject) => {
    const request = http2Session(host).request({
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      ...headers,
    })
    let status = 0
    let data = ''

    request.setEncoding('utf8')
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.close(constants.NGHTTP2_CANCEL)
      reject(new Error('APNs request timed out'))
    })
    request.on('response', (responseHeaders) => {
      status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS] ?? 0)
    })
    request.on('data', (chunk: string) => {
      data += chunk
    })
    request.on('end', () => {
      let reason: string | undefined

      try {
        reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined
      } catch {
        reason = undefined
      }
      resolve({ status, reason })
    })
    request.on('error', reject)
    request.end(body)
  })

// APNs refuses a stream when a connection is at its limit or in GOAWAY; the
// request was never processed, so a fresh connection can carry it. Half the
// backoff is fixed, half jittered, so two refused pushes do not reconnect together.
export const APNS_SEND_ATTEMPTS = 3
const RETRY_BASE_MS = 200
const RETRY_MAX_MS = 2_000
const NGHTTP2_CODE = /NGHTTP2_[A-Z_]+/u
const REFUSED_STREAM = 'NGHTTP2_REFUSED_STREAM'

// The socket died before APNs answered, so no rejection was handed back.
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_HTTP2_SESSION_ERROR',
])

export function apnsRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)

  return Math.round(ceiling / 2 + random() * (ceiling / 2))
}

/** Node names the nghttp2 code in the message, not in `error.code`, and only
 *  REFUSED_STREAM promises the request was never processed. */
export function isTransientApnsFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code

  return (
    (typeof code === 'string' && TRANSIENT_CODES.has(code)) ||
    NGHTTP2_CODE.exec(error.message)?.[0] === REFUSED_STREAM
  )
}

/** The nghttp2 code the message names, else the error's own code. */
function failureCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const named = NGHTTP2_CODE.exec(error.message)?.[0]
  const code = (error as { code?: unknown }).code

  if (named) return named

  return typeof code === 'string' ? code : 'unknown'
}

/** The cached session goes before the wait, so the retry is not on it. */
async function retryAfter(host: string, attempt: number, code: string): Promise<void> {
  resetSession(host)
  logEvent('warn', 'push.apns.retry', { attempt, of: APNS_SEND_ATTEMPTS, code })
  await new Promise((resolve) => {
    setTimeout(resolve, apnsRetryDelayMs(attempt - 1))
  })
}

let transport: ApnsTransport = http2Transport

export function setApnsTransportForTests(next: ApnsTransport | null): void {
  transport = next ?? http2Transport
  cachedToken = null
}

export async function sendApns(
  credentials: ApnsCredentials,
  request: ApnsRequest,
  nowMs = Date.now(),
): Promise<ApnsResponse> {
  const pushType = request.pushType ?? 'alert'
  const host = HOSTS[request.environment]
  const headers: Record<string, string> = {
    [constants.HTTP2_HEADER_PATH]: `/3/device/${request.deviceToken}`,
    authorization: `bearer ${providerToken(credentials, nowMs)}`,
    'apns-topic':
      pushType === 'liveactivity'
        ? `${credentials.bundleId}.push-type.liveactivity`
        : credentials.bundleId,
    'apns-push-type': pushType,
    'apns-priority': '10',
    'content-type': 'application/json',
  }

  if (request.collapseId) headers['apns-collapse-id'] = request.collapseId.slice(0, 64)
  const body = JSON.stringify(request.payload)

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await transport(host, headers, body)

      // APNs answers every request with a status; none means the stream closed first.
      if (response.status !== 0 || attempt >= APNS_SEND_ATTEMPTS) return response
      await retryAfter(host, attempt, 'no-response')
    } catch (error) {
      if (attempt >= APNS_SEND_ATTEMPTS || !isTransientApnsFailure(error)) throw error
      await retryAfter(host, attempt, failureCode(error))
    }
  }
}

/** The token will never deliver again: uninstalled app, revoked permission,
 *  or a token from an APNs environment our key cannot send to (an Xcode build's
 *  sandbox token when the key is limited to production). */
export function isDeadToken(response: ApnsResponse): boolean {
  if (response.status === 410) return true
  if (response.status === 403) return response.reason === 'BadEnvironmentKeyInToken'

  return (
    response.status === 400 &&
    (response.reason === 'BadDeviceToken' || response.reason === 'DeviceTokenNotForTopic')
  )
}
