import {
  decryptGithubSecret,
  decryptLinearSecret,
  encryptGithubSecret,
  encryptLinearSecret,
} from '@/lib/byos/secrets'

import type { EncryptedSecret, SealerName } from '@/lib/byos/secrets'
import type { PersonalCredentialProvider } from '@/models'

/** GitHub grants use the GitHub key; Linear and Google grants share the Linear key. */
export const sealerOf = (provider: PersonalCredentialProvider): SealerName =>
  provider === 'github' ? 'github' : 'linear'

export const seal = (provider: PersonalCredentialProvider, plaintext: string) =>
  provider === 'github' ? encryptGithubSecret(plaintext) : encryptLinearSecret(plaintext)
export const open = (provider: PersonalCredentialProvider, envelope: EncryptedSecret) =>
  provider === 'github' ? decryptGithubSecret(envelope) : decryptLinearSecret(envelope)
