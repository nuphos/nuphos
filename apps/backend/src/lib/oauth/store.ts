// Storage for the Nuphos MCP OAuth server: dynamically-registered clients,
// single-use authorization codes, and refresh tokens. Codes and refresh tokens
// are keyed by their SHA-256 hash (the _id), so the stored value is never a
// usable credential and single-use consumption is an indexed deleteOne.

import { db } from '@/lib/db'

import { generateOpaqueToken, hashToken } from './tokens'

import type { Collection } from 'mongodb'

// ─── Registered clients (RFC 7591 Dynamic Client Registration) ──────────────

export type McpOAuthClient = {
  _id: string // client_id (public identifier)
  clientName: string | null
  redirectUris: string[]
  scope: string
  createdAt: Date
}

export const mcpOAuthClients = (): Collection<McpOAuthClient> =>
  db().collection<McpOAuthClient>('mcp_oauth_clients')

export async function registerClient(params: {
  clientName: string | null
  redirectUris: string[]
  scope: string
}): Promise<McpOAuthClient> {
  const client: McpOAuthClient = {
    _id: `mcp_${generateOpaqueToken()}`,
    clientName: params.clientName,
    redirectUris: params.redirectUris,
    scope: params.scope,
    createdAt: new Date(),
  }

  await mcpOAuthClients().insertOne(client)

  return client
}

export async function getClient(clientId: string): Promise<McpOAuthClient | null> {
  return mcpOAuthClients().findOne({ _id: clientId })
}

// ─── Authorization codes (short-lived, single-use, PKCE-bound) ──────────────

export type McpAuthCode = {
  _id: string // hashToken(code)
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  scope: string
  resource: string
  expiresAt: Date
}

export const mcpAuthCodes = (): Collection<McpAuthCode> =>
  db().collection<McpAuthCode>('mcp_oauth_auth_codes')

const AUTH_CODE_TTL_MS = 5 * 60 * 1000

// Mints an authorization code, stores only its hash, and returns the plaintext
// code for the redirect.
export async function issueAuthCode(params: {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  scope: string
  resource: string
}): Promise<string> {
  const code = generateOpaqueToken()

  await mcpAuthCodes().insertOne({
    _id: hashToken(code),
    clientId: params.clientId,
    userId: params.userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope: params.scope,
    resource: params.resource,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  })

  return code
}

// Atomically consumes a code (single-use). Returns the record if it existed and
// had not expired, else null.
export async function consumeAuthCode(code: string): Promise<McpAuthCode | null> {
  const record = await mcpAuthCodes().findOneAndDelete({ _id: hashToken(code) })

  if (!record) return null
  if (record.expiresAt.getTime() < Date.now()) return null

  return record
}

// ─── Refresh tokens (rotated on use) ────────────────────────────────────────

export type McpRefreshToken = {
  _id: string // hashToken(token)
  clientId: string
  userId: string
  scope: string
  resource: string
  expiresAt: Date
}

export const mcpRefreshTokens = (): Collection<McpRefreshToken> =>
  db().collection<McpRefreshToken>('mcp_oauth_refresh_tokens')

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function issueRefreshToken(params: {
  clientId: string
  userId: string
  scope: string
  resource: string
}): Promise<string> {
  const token = generateOpaqueToken()

  await mcpRefreshTokens().insertOne({
    _id: hashToken(token),
    clientId: params.clientId,
    userId: params.userId,
    scope: params.scope,
    resource: params.resource,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  })

  return token
}

// Atomically consumes a refresh token (rotation). Returns the record if valid.
export async function consumeRefreshToken(token: string): Promise<McpRefreshToken | null> {
  const record = await mcpRefreshTokens().findOneAndDelete({ _id: hashToken(token) })

  if (!record) return null
  if (record.expiresAt.getTime() < Date.now()) return null

  return record
}

// TTL indexes so expired codes/tokens are reaped by Mongo.
export async function setupMcpOAuthIndexes(): Promise<void> {
  await mcpAuthCodes().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'mcp_oauth_auth_codes_ttl' },
  )
  await mcpRefreshTokens().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'mcp_oauth_refresh_tokens_ttl' },
  )
}
