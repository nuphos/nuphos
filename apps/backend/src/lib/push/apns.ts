import { createPrivateKey, sign } from 'node:crypto'
import { connect, constants } from 'node:http2'

import { config } from '@/config'

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
  const headers: Record<string, string> = {
    [constants.HTTP2_HEADER_PATH]: `/3/device/${request.deviceToken}`,
    authorization: `bearer ${providerToken(credentials, nowMs)}`,
    'apns-topic': credentials.bundleId,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json',
  }

  if (request.collapseId) headers['apns-collapse-id'] = request.collapseId.slice(0, 64)

  return transport(HOSTS[request.environment], headers, JSON.stringify(request.payload))
}

/** The token will never deliver again: uninstalled app, revoked permission,
 *  or a token from the other APNs environment. */
export function isDeadToken(response: ApnsResponse): boolean {
  if (response.status === 410) return true

  return (
    response.status === 400 &&
    (response.reason === 'BadDeviceToken' || response.reason === 'DeviceTokenNotForTopic')
  )
}
