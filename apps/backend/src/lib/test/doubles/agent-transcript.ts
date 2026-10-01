import { mock } from 'bun:test'

import * as actual from '@/routes/agent/transcript'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/transcript', actual)

await mock.module('@/routes/agent/transcript', () => double)

export const useAgentTranscript = makeInstaller<typeof actual>('@/routes/agent/transcript')
