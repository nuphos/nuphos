import { mock } from 'bun:test'

import * as actual from '@/routes/agent/session-queue-turn'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/session-queue-turn', actual)

await mock.module('@/routes/agent/session-queue-turn', () => double)

export const useSessionQueueTurn = makeInstaller<typeof actual>('@/routes/agent/session-queue-turn')
