import { db } from '@/lib/db'

import type { EncryptedSecret } from '@/lib/byos/secrets/shared'
import type { Collection, ObjectId } from 'mongodb'

export type PersonalCredentialProvider = 'github' | 'linear'

/**
 * A member's own GitHub (user-to-server) or Linear (actor=user) OAuth grant.
 * One per user and provider. The agent's credential handouts return it in
 * place of the team token when this member sent the turn's message.
 */
export type PersonalCredential = {
  _id: ObjectId
  userId: string
  provider: PersonalCredentialProvider
  providerUserId: string
  login: string
  /** Linear only: the organization this grant belongs to. */
  workspaceId?: string
  workspaceName?: string
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
  /** GitHub PKCE verifier, sealed with the provider's key. */
  encryptedCodeVerifier?: EncryptedSecret
  /** After the callback: the exchanged grant, waiting for its starter to claim it with the code. */
  staged?: Omit<PersonalCredential, '_id' | 'userId' | 'provider' | 'createdAt' | 'updatedAt'>
  codeHash?: string
  // Mongo TTL index removes expired pending records once expiresAt passes.
  expiresAt: Date
}

export const personalCredentialPendingOAuth = (): Collection<PersonalCredentialPendingOAuth> =>
  db().collection<PersonalCredentialPendingOAuth>('personal_credential_oauth_pending')
