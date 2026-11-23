import { mock } from 'bun:test'

import * as actual from '@/lib/agent/channel-chat'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/lib/agent/channel-chat', actual)

await mock.module('@/lib/agent/channel-chat', () => double)

export const useChannelChat = makeInstaller<typeof actual>('@/lib/agent/channel-chat')
