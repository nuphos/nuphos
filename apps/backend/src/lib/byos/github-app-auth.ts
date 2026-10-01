import { createHmac, createSign, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'

class GithubAppNotConfiguredError extends Error {
  constructor() {
    super('GitHub App is not configured (set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY)')
  }
}

export class GithubAppNotConfigured extends GithubAppNotConfiguredError {}

function loadPrivateKey(): string {
  const { privateKey, privateKeyBase64 } = config.byos.github

  if (privateKey) return privateKey
  if (privateKeyBase64) return Buffer.from(privateKeyBase64, 'base64').toString('utf-8')
  throw new GithubAppNotConfigured()
}

export function isGithubAppConfigured(): boolean {
  const { appId, privateKey, privateKeyBase64 } = config.byos.github

  return Boolean(appId && (privateKey || privateKeyBase64))
}

export function getGithubAppSlug(): string | undefined {
  const slug = config.byos.github.appSlug

  return slug === 'zeabur-atlas' ? 'nuphos' : slug
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

let cachedAppJwt: { token: string; expiresAt: number } | null = null

export function generateAppJwt(): string {
  const { appId } = config.byos.github

  if (!appId) throw new GithubAppNotConfigured()

  const now = Math.floor(Date.now() / 1000)

  if (cachedAppJwt && cachedAppJwt.expiresAt - 30 > now) {
    return cachedAppJwt.token
  }

  const privateKey = loadPrivateKey()
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  )
  const signingInput = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')

  signer.update(signingInput)
  const signature = signer.sign(privateKey).toString('base64url')
  const token = `${signingInput}.${signature}`

  cachedAppJwt = { token, expiresAt: now + 9 * 60 }

  return token
}

export function buildInstallUrl(state?: string): string | null {
  const slug = getGithubAppSlug()

  if (!slug) return null
  const base = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`

  if (!state) return base

  return `${base}?state=${encodeURIComponent(state)}`
}

export function verifyWebhookSignature(
  rawBody: Uint8Array,
  header: string | null | undefined,
): boolean {
  const secret = config.byos.github.webhookSecret

  if (!secret) return false
  if (!header?.startsWith('sha256=')) return false
  const provided = Buffer.from(header.slice('sha256='.length), 'hex')

  if (provided.length !== 32) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()

  return timingSafeEqual(provided, expected)
}
