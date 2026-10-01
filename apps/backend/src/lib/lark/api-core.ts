import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'

import { AppError } from '@/lib/errors'

// The Lark connector is CUSTOM-APP-ONLY: every call authenticates with a
// specific team's own 企业自建应用 credentials, resolved (and decrypted) from its
// binding. There is no global Nuphos Lark app.
export type LarkDomain = 'feishu' | 'larksuite'

export type LarkAppContext = {
  appId: string
  appSecret: string
  domain: LarkDomain
}

export function larkApiHost(domain: LarkDomain): string {
  return domain === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com'
}

// ─── Event decryption + signature verification (per-app Encrypt Key) ─────────
// Encrypted event bodies arrive as {"encrypt": base64(iv[16] + AES-256-CBC(
// sha256(encryptKey), event))}, PKCS7 padded. The Encrypt Key is per app, so it
// is passed in (read from the routed binding) rather than global config.
export function decryptLarkEvent(encrypt: string, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey).digest()
  const buf = Buffer.from(encrypt, 'base64')
  const iv = buf.subarray(0, 16)
  const data = buf.subarray(16)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()])

  return plaintext.toString('utf8')
}

// Callback signature: sha256(timestamp + nonce + encryptKey + rawBody) hex.
export function verifyLarkSignature(args: {
  encryptKey: string
  rawBody: string
  timestamp: string | undefined
  nonce: string | undefined
  signature: string | undefined
}): boolean {
  if (!args.encryptKey || !args.timestamp || !args.nonce || !args.signature) return false
  const expected = createHash('sha256')
    .update(args.timestamp + args.nonce + args.encryptKey + args.rawBody)
    .digest('hex')
  const a = Buffer.from(args.signature)
  const b = Buffer.from(expected)

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

// ─── Token manager (per custom app) ──────────────────────────────────────────
// A custom app mints its tenant_access_token straight from app_id + app_secret
// (the /internal endpoint) — no app_ticket, no ISV chain. Cache + inflight map
// are keyed by appId so a burst of turns triggers one mint, not N.
const EXPIRY_MARGIN_MS = 60_000

type CachedToken = { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()
const tokenInflight = new Map<string, Promise<string>>()

export async function getTenantAccessToken(ctx: LarkAppContext): Promise<string> {
  const cached = tokenCache.get(ctx.appId)

  if (cached && cached.expiresAt > Date.now()) return cached.token
  const existing = tokenInflight.get(ctx.appId)

  if (existing) return existing

  const promise = (async () => {
    const json = (await larkFetch(
      ctx.domain,
      'POST',
      '/open-apis/auth/v3/tenant_access_token/internal/',
      {
        app_id: ctx.appId,
        app_secret: ctx.appSecret,
      },
    )) as { tenant_access_token?: string; expire?: number }

    if (!json.tenant_access_token) {
      throw new AppError(502, 'lark_api_error', 'Lark did not return a tenant_access_token')
    }
    tokenCache.set(ctx.appId, {
      token: json.tenant_access_token,
      expiresAt: Date.now() + (json.expire ?? 7200) * 1000 - EXPIRY_MARGIN_MS,
    })

    return json.tenant_access_token
  })().finally(() => tokenInflight.delete(ctx.appId))

  tokenInflight.set(ctx.appId, promise)

  return promise
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
// Unauthenticated call to the token endpoint; asserts Lark's {code:0} envelope.
async function larkFetch(
  domain: LarkDomain,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response: Response

  try {
    response = await fetch(`${larkApiHost(domain)}${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    throw new AppError(
      502,
      'lark_api_error',
      err instanceof Error
        ? `Lark ${path} request failed: ${err.message}`
        : `Lark ${path} request failed`,
    )
  }
  let json: Record<string, unknown>

  try {
    json = (await response.json()) as Record<string, unknown>
  } catch {
    throw new AppError(502, 'lark_api_error', `Lark ${path} returned an unparseable response`)
  }
  if (typeof json.code === 'number' && json.code !== 0) {
    const msg = typeof json.msg === 'string' && json.msg ? json.msg : 'Lark error'

    throw new AppError(502, 'lark_api_error', `${msg} (code ${String(json.code)})`)
  }

  return json
}

export type LarkApiResponse = {
  code: number
  msg?: string
  data?: Record<string, unknown>
}

// Authenticated Open API call; mints/uses the app's tenant_access_token.
export async function larkApi(args: {
  ctx: LarkAppContext
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string | number | undefined>
  body?: Record<string, unknown>
}): Promise<LarkApiResponse> {
  const token = await getTenantAccessToken(args.ctx)
  const url = new URL(`${larkApiHost(args.ctx.domain)}${args.path}`)

  for (const [k, v] of Object.entries(args.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  let response: Response

  try {
    response = await fetch(url.toString(), {
      method: args.method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      ...(args.body ? { body: JSON.stringify(args.body) } : {}),
    })
  } catch (err) {
    throw new AppError(
      502,
      'lark_api_error',
      err instanceof Error
        ? `Lark ${args.path} request failed: ${err.message}`
        : `Lark ${args.path} request failed`,
    )
  }
  let json: LarkApiResponse

  try {
    json = (await response.json()) as LarkApiResponse
  } catch {
    throw new AppError(502, 'lark_api_error', `Lark ${args.path} returned an unparseable response`)
  }
  if (json.code !== 0) {
    throw new AppError(
      502,
      'lark_api_error',
      `${json.msg ?? 'Lark error'} (code ${String(json.code)})`,
    )
  }

  return json
}

// Verifies a set of app credentials by minting a token — used at bind time to
// reject a bad app_id/app_secret before storing them.
export async function verifyLarkCredentials(ctx: LarkAppContext): Promise<void> {
  await getTenantAccessToken(ctx)
}
