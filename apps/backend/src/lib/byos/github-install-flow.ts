import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { getCookie } from 'hono/cookie'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { getInstallation } from '@/lib/byos/github'
import { publicBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { teamByosBindings } from '@/models'

import type { GithubInstallationBinding } from '@/models'
import type { Context } from 'hono'

// The setup flow binds a GitHub installation to a team. The backend signs who
// started the flow, and binds only after that person's own GitHub
// authorization lists the installation and they confirm the destination team.

const TTL_MS = 10 * 60 * 1000

export type InstallFlowState = {
  /** Team the installation is bound to. */
  t: string
  /** Nuphos user who started the flow. */
  u: string
  /** The client's own correlation state, handed back unchanged. */
  s?: string
  /** Installation id and setup action, once GitHub has returned them. */
  i?: number
  a?: string
  /** Set once GitHub confirmed the user's access; only the confirm step accepts it. */
  v?: 1
  e: number
  n: string
}

function mac(payload: string): Buffer {
  const secret = config.auth.jwtSecret

  if (!secret) throw new Error('NUPHOS_JWT_SECRET is not configured')

  return createHmac('sha256', secret).update(`github-install-flow:${payload}`).digest()
}

/** Re-signing keeps the original expiry: the whole flow has one 10-minute window. */
export function encodeInstallFlowState(state: InstallFlowState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')

  return `${payload}.${mac(payload).toString('base64url')}`
}

export function signInstallFlowState(state: Omit<InstallFlowState, 'e' | 'n'>): string {
  return encodeInstallFlowState({
    ...state,
    e: Date.now() + TTL_MS,
    n: randomBytes(12).toString('base64url'),
  })
}

export function verifyInstallFlowState(token: string | undefined): InstallFlowState | null {
  const [payload, sig, extra] = (token ?? '').split('.')

  if (!payload || !sig || extra !== undefined) return null
  const expected = mac(payload)
  const given = Buffer.from(sig, 'base64url')

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as InstallFlowState

    return state.e > Date.now() ? state : null
  } catch {
    return null
  }
}

/** PKCE verifier derived from the flow's nonce, so nothing is stored server-side. */
export function installFlowVerifier(state: InstallFlowState): string {
  return mac(`pkce:${state.n}`).toString('base64url')
}

/** Where both GitHub legs (install setup and user authorization) return. */
export function githubSetupUrl(): string | null {
  const base = publicBackendUrl()

  return base?.startsWith('https://') ? `${base.replace(/\/$/u, '')}/github-app/setup` : null
}

/** The flow's starting URL; clients may append their own `state`. */
export function githubInstallStartUrl(signedState: string): string | null {
  const setup = githubSetupUrl()

  return setup ? `${setup.replace(/\/setup$/u, '/install')}?ticket=${signedState}` : null
}

/** The browser that opened the flow holds its nonce; another browser cannot finish it. */
export const INSTALL_FLOW_COOKIE = 'nuphos_github_install'

/** The team's name when the user still administers it. */
export async function administeredTeamName(userId: string, teamId: string): Promise<string | null> {
  const membership = await getTeamMembership(userId, teamId)

  return membership?.role === 'ADMINISTRATOR' ? membership.team.name : null
}

/** Idempotent: an installation already bound to the team is returned as is. */
export async function bindGithubInstallation(
  teamId: ObjectId,
  installationId: number,
): Promise<GithubInstallationBinding> {
  const existing = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { githubInstallations: 1 } },
  )
  const bound = existing?.githubInstallations.find((b) => b.installationId === installationId)

  if (bound) return bound

  const info = await getInstallation(installationId)
  const createdAt = new Date()
  const binding: GithubInstallationBinding = {
    id: new ObjectId(),
    installationId,
    accountLogin: info.account.login,
    accountType: info.account.type,
    accountId: info.account.id,
    targetType: info.repositorySelection,
    createdAt,
  }

  const result = await teamByosBindings().updateOne(
    { _id: teamId, 'githubInstallations.installationId': { $ne: installationId } },
    {
      $push: { githubInstallations: binding },
      $set: { updatedAt: createdAt },
      $setOnInsert: {
        awsRoles: [],
        gcpServiceAccounts: [],
        grafanaInstances: [],
        cloudflareAccounts: [],
        linodeAccounts: [],
        tailscaleClients: [],
        zeaburProviders: [],
      },
    },
    { upsert: !existing },
  )

  if (result.modifiedCount + result.upsertedCount > 0) return binding

  // A concurrent flow bound it first.
  const doc = await teamByosBindings().findOne({ _id: teamId })

  return doc?.githubInstallations.find((b) => b.installationId === installationId) ?? binding
}

export function invalidFlow(): never {
  throw new AppError(
    400,
    'invalid_github_install_state',
    'This GitHub installation link is invalid or has expired. Start again from Nuphos.',
  )
}

/** A valid state that this browser started. */
export function browserFlowState(c: Context, token: string | undefined): InstallFlowState {
  const state = verifyInstallFlowState(token)

  if (!state || getCookie(c, INSTALL_FLOW_COOKIE) !== state.n) invalidFlow()

  return state
}
