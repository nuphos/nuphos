import { db } from '@/lib/db'

import type { SocialProvider } from '@/lib/identity/social'

type Attempt = {
  _id: string
  provider: SocialProvider
  nonce: string
  handle?: string
  expiresAt: Date
}
export const socialAuthAttempts = () => db().collection<Attempt>('social_auth_attempts')
export async function setupSocialAuthIndexes() {
  await socialAuthAttempts().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}
