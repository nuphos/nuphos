import { mock } from 'bun:test'

import * as actual from '@/routes/agent/session-queue-sign-in'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/session-queue-sign-in', actual)

await mock.module('@/routes/agent/session-queue-sign-in', () => double)

export const useSessionQueueSignIn = makeInstaller<typeof actual>(
  '@/routes/agent/session-queue-sign-in',
)
