import { mock } from 'bun:test'

import * as actual from '@/routes/agent/trigger-run-execute'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/trigger-run-execute', actual)

await mock.module('@/routes/agent/trigger-run-execute', () => double)

export const useTriggerRunExecute = makeInstaller<typeof actual>(
  '@/routes/agent/trigger-run-execute',
)
