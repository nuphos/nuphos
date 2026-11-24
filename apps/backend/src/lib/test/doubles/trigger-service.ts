import { mock } from 'bun:test'

import * as actual from '@/lib/agent/trigger-service'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/lib/agent/trigger-service', actual)

await mock.module('@/lib/agent/trigger-service', () => double)

export const useTriggerService = makeInstaller<typeof actual>('@/lib/agent/trigger-service')
