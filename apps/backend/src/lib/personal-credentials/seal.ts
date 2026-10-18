import {
  decryptGithubSecret,
  decryptLinearSecret,
  encryptGithubSecret,
  encryptLinearSecret,
} from '@/lib/byos/secrets'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { PersonalCredentialProvider } from '@/models'

export const seal = (provider: PersonalCredentialProvider, plaintext: string) =>
  provider === 'github' ? encryptGithubSecret(plaintext) : encryptLinearSecret(plaintext)
export const open = (provider: PersonalCredentialProvider, envelope: EncryptedSecret) =>
  provider === 'github' ? decryptGithubSecret(envelope) : decryptLinearSecret(envelope)
