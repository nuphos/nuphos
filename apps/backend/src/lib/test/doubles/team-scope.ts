import { mock } from 'bun:test'

import * as actual from '@/routes/agent/team-scope'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/team-scope', actual)

await mock.module('@/routes/agent/team-scope', () => double)

export const useTeamScope = makeInstaller<typeof actual>('@/routes/agent/team-scope')
