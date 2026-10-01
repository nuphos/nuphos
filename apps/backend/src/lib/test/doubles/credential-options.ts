import { mock } from 'bun:test'

import * as actual from '@/routes/agent/credential-options'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/routes/agent/credential-options', actual)

await mock.module('@/routes/agent/credential-options', () => double)

export const useCredentialOptions = makeInstaller<typeof actual>(
  '@/routes/agent/credential-options',
)
