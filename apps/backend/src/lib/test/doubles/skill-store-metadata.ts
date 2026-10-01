import { mock } from 'bun:test'

import * as actual from '@/lib/agent/skill-store/metadata'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/skill-store/metadata', actual)

await mock.module('@/lib/agent/skill-store/metadata', () => double)

export const useSkillStoreMetadata = makeInstaller<typeof actual>(
  '@/lib/agent/skill-store/metadata',
)
