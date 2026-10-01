import { mock } from 'bun:test'

import * as actual from '@/lib/agent/skill-store/service'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/skill-store/service', actual)

await mock.module('@/lib/agent/skill-store/service', () => double)

export const useSkillStoreService = makeInstaller<typeof actual>('@/lib/agent/skill-store/service')
