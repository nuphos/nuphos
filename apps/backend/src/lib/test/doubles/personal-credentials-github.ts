import { mock } from 'bun:test'

import * as actual from '@/lib/personal-credentials/github'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/personal-credentials/github', actual)

await mock.module('@/lib/personal-credentials/github', () => double)
export const usePersonalCredentialsGithub = makeInstaller<typeof actual>(
  '@/lib/personal-credentials/github',
)
