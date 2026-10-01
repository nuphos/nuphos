import { createHash, createHmac } from 'node:crypto'

// Huawei's SDK-HMAC-SHA256 request signing, as implemented by the official
// SDKs (huaweicloud-sdk-python-v3 signer.Signer, huaweicloud-sdk-go-v3
// core/auth/signer). Temporary credentials sign the same way plus a signed
// X-Security-Token header. The sandbox skill's hw-api.py is the same algorithm.
const ALGORITHM = 'SDK-HMAC-SHA256'

function encode(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => {
    const ch = String.fromCharCode(byte)

    return /[A-Za-z0-9\-._~]/.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')
}

function byCodePoint(a: string, b: string): number {
  if (a === b) return 0

  return a < b ? -1 : 1
}

function canonicalUri(pathname: string): string {
  const uri = decodeURIComponent(pathname || '/')
    .split('/')
    .map(encode)
    .join('/')

  return uri.endsWith('/') ? uri : `${uri}/`
}

export function canonicalQuery(params: URLSearchParams): string {
  return Array.from(params.entries())
    .sort(([ak, av], [bk, bv]) => byCodePoint(ak, bk) || byCodePoint(av, bv))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join('&')
}

function signedHeaderNames(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .filter((name) => !name.includes('_'))
    .map((name) => name.toLowerCase())
    .sort(byCodePoint)
}

export type HuaweiRequest = {
  method: string
  url: URL
  headers: Record<string, string>
  payload: Buffer
}

/** The Authorization value for a request whose headers already hold X-Sdk-Date. */
export function huaweiAuthorization(
  { method, url, headers, payload }: HuaweiRequest,
  { accessKeyId, secretAccessKey }: { accessKeyId: string; secretAccessKey: string },
): string {
  const values = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]))
  const names = signedHeaderNames(headers)
  const canonical = [
    method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    names.map((name) => `${name}:${values.get(name) ?? ''}\n`).join(''),
    names.join(';'),
    values.get('x-sdk-content-sha256') ?? createHash('sha256').update(payload).digest('hex'),
  ].join('\n')
  const stringToSign = `${ALGORITHM}\n${values.get('x-sdk-date') ?? ''}\n${createHash('sha256').update(canonical).digest('hex')}`
  const signature = createHmac('sha256', secretAccessKey).update(stringToSign).digest('hex')

  return `${ALGORITHM} Access=${accessKeyId}, SignedHeaders=${names.join(';')}, Signature=${signature}`
}

/** Sign a request with temporary (federated) credentials. Returns the headers to send. */
export function signHuaweiRequest(
  method: string,
  url: URL,
  handle: { accessKeyId: string; secretAccessKey: string; securityToken: string },
  body?: string,
  now: Date = new Date(),
): Record<string, string> {
  const payload = Buffer.from(body ?? '', 'utf-8')
  const headers: Record<string, string> = {
    Host: url.host,
    'X-Sdk-Date': now.toISOString().replace(/[-:]|\.\d+/g, ''),
    'X-Security-Token': handle.securityToken,
  }

  if (body) headers['Content-Type'] = 'application/json'

  headers.Authorization = huaweiAuthorization({ method, url, headers, payload }, handle)

  return headers
}
