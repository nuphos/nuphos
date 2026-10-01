import { mock } from 'bun:test'

import * as actual from '@/lib/agent/skill-store/sync'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/skill-store/sync', actual)

await mock.module('@/lib/agent/skill-store/sync', () => double)

export const useSkillStoreSync = makeInstaller<typeof actual>('@/lib/agent/skill-store/sync')
