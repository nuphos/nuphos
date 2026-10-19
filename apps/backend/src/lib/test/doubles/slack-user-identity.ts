import { mock } from 'bun:test'

import * as actual from '@/routes/slack/identity'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/routes/slack/identity', actual)

await mock.module('@/routes/slack/identity', () => double)

export const useSlackUserIdentity = makeInstaller<typeof actual>('@/routes/slack/identity')
