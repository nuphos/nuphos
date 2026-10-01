import { mock } from 'bun:test'

import * as actual from '@/routes/agent/chat-slack-bound'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/chat-slack-bound', actual)

await mock.module('@/routes/agent/chat-slack-bound', () => double)

export const useChatSlackBound = makeInstaller<typeof actual>('@/routes/agent/chat-slack-bound')
