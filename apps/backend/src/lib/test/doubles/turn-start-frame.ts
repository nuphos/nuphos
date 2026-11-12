import { mock } from 'bun:test'

import * as actual from '@/routes/agent/turn-start-frame'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/turn-start-frame', actual)

await mock.module('@/routes/agent/turn-start-frame', () => double)

export const useTurnStartFrame = makeInstaller<typeof actual>('@/routes/agent/turn-start-frame')
