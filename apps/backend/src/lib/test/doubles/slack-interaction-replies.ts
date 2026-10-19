import { mock } from 'bun:test'

import * as actual from '@/routes/slack/interaction-replies'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/routes/slack/interaction-replies', actual)

await mock.module('@/routes/slack/interaction-replies', () => double)

export const useSlackInteractionReplies = makeInstaller<typeof actual>(
  '@/routes/slack/interaction-replies',
)
