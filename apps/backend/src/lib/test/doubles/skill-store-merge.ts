import { mock } from 'bun:test'

import * as actual from '@/lib/agent/skill-store/merge'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/agent/skill-store/merge', actual)

await mock.module('@/lib/agent/skill-store/merge', () => double)

export const useSkillStoreMerge = makeInstaller<typeof actual>('@/lib/agent/skill-store/merge')
