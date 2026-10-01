import { mock } from 'bun:test'

import * as actual from '@/lib/agent/run-store'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/agent/run-store', actual)

await mock.module('@/lib/agent/run-store', () => double)

export const useAgentRunStore = makeInstaller<typeof actual>('@/lib/agent/run-store')
