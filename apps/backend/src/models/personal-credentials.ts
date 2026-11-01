import { db } from '@/lib/db'

import type { EncryptedSecret } from '@/lib/byos/secrets/shared'
import type { Collection, ObjectId } from 'mongodb'

export type PersonalCredentialProvider = 'github' | 'linear' | 'gmail' | 'google-drive'

/**
 * A member's own GitHub (user-to-server), Linear (actor=user) or Google OAuth
 * grant. One per user and provider. The GitHub and Linear handouts return it in
 * place of the team token when this member sent the turn's message; Gmail and
 * Google Drive have no team token and are only ever the member's own.
 */
export type PersonalCredential = {
  _id: ObjectId
  userId: string
  provider: PersonalCredentialProvider
  providerUserId: string
  login: string
  /** Linear only: the organization this grant belongs to. */
  workspaceId?: string
  /** Linear: the organization's name. Gmail / Google Drive: the Nuphos team's name. */
  workspaceName?: string
  /** Gmail / Google Drive only: the team whose OAuth client issued this grant. */
  teamId?: string
  encryptedAccessToken: EncryptedSecret
  encryptedRefreshToken: EncryptedSecret | null
  accessTokenExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export const personalCredentials = (): Collection<PersonalCredential> =>
  db().collection<PersonalCredential>('personal_credentials')

export type PersonalCredentialPendingOAuth = {
  // The state token echoed back by the provider.
  _id: string
  userId: string
  provider: PersonalCredentialProvider
  /** Gmail / Google Drive only: the team whose OAuth client this flow uses. */
  teamId?: string
  /** GitHub / Google PKCE verifier, sealed with the provider's key. */
  encryptedCodeVerifier?: EncryptedSecret
  /** After the callback: the exchanged grant, waiting for its starter to claim it with the code. */
  staged?: Omit<PersonalCredential, '_id' | 'userId' | 'provider' | 'createdAt' | 'updatedAt'>
  codeHash?: string
  // Mongo TTL index removes expired pending records once expiresAt passes.
  expiresAt: Date
}

export const personalCredentialPendingOAuth = (): Collection<PersonalCredentialPendingOAuth> =>
  db().collection<PersonalCredentialPendingOAuth>('personal_credential_oauth_pending')
