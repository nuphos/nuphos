import { mock } from 'bun:test'

import * as actual from '@/lib/agent/tools-team-skills'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/agent/tools-team-skills', actual)

await mock.module('@/lib/agent/tools-team-skills', () => double)

export const useTeamSkillTools = makeInstaller<typeof actual>('@/lib/agent/tools-team-skills')
