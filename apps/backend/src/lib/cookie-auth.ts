// Best-effort extraction of a Nuphos session token from a browser Cookie
// header. The web app and admin surfaces have set the token under a few
// different names (and occasionally wrapped in JSON), so we probe a bounded
// list of candidates rather than one canonical cookie.

import { authenticateToken } from '@/lib/identity'

import type { NuphosUser } from '@/lib/identity'

const MAX_TOKEN_ATTEMPTS = 8

const DEFAULT_COOKIE_NAMES = [
  'nuphos_token',
  'nuphosToken',
  'access_token',
  'accessToken',
  'auth_token',
  'authToken',
  'token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
]

export function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const out = new Map<string, string>()

  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=')

    if (index <= 0) continue
    const name = part.slice(0, index).trim()
    const rawValue = part.slice(index + 1).trim()

    if (!name) continue
    out.set(name, safeDecodeURIComponent(rawValue))
  }

  return out
}

// Returns up to MAX_TOKEN_ATTEMPTS plausible session tokens from the cookie
// header, preferring `extraNames` (e.g. deployment-specific names from config).
export function collectCookieTokenCandidates(
  cookieHeader: string | undefined,
  extraNames: string[] = [],
): string[] {
  const cookies = parseCookies(cookieHeader)
  const candidates = new Set<string>()

  for (const name of [...extraNames, ...DEFAULT_COOKIE_NAMES]) {
    if (candidates.size >= MAX_TOKEN_ATTEMPTS) break
    const value = cookies.get(name)

    if (value) collectTokenCandidates(value, candidates)
  }

  return Array.from(candidates).slice(0, MAX_TOKEN_ATTEMPTS)
}

// First cookie token that authenticates wins. Returns null when no cookie
// yields a valid session — callers fall back to their interactive login.
export async function authenticateUserFromCookies(
  cookieHeader: string | undefined,
  extraNames: string[] = [],
): Promise<NuphosUser | null> {
  for (const token of collectCookieTokenCandidates(cookieHeader, extraNames)) {
    const result = await authenticateToken(token)

    if (result) return result.user
  }

  return null
}

function collectTokenCandidates(raw: string, out: Set<string>): void {
  if (out.size >= MAX_TOKEN_ATTEMPTS) return
  const value = normalizeCookieToken(raw)

  if (value.length >= 16) out.add(value)
  if (out.size >= MAX_TOKEN_ATTEMPTS) return
  const nested = tryParseJson(value)

  if (nested) collectNestedTokenCandidates(nested, out)
}

function collectNestedTokenCandidates(value: unknown, out: Set<string>): void {
  if (out.size >= MAX_TOKEN_ATTEMPTS) return
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (out.size >= MAX_TOKEN_ATTEMPTS) return
    if (typeof nested === 'string' && /token/i.test(key)) {
      const token = normalizeCookieToken(nested)

      if (token.length >= 16) out.add(token)
    } else if (nested && typeof nested === 'object') {
      collectNestedTokenCandidates(nested, out)
    }
  }
}

function normalizeCookieToken(raw: string): string {
  let value = safeDecodeURIComponent(raw).trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  if (value.toLowerCase().startsWith('bearer ')) {
    value = value.slice('bearer '.length).trim()
  }

  return value
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
