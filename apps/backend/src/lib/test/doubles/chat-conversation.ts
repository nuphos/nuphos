import { mock } from 'bun:test'

import * as actual from '@/routes/agent/chat-conversation'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/chat-conversation', actual)

await mock.module('@/routes/agent/chat-conversation', () => double)

export const useChatConversation = makeInstaller<typeof actual>('@/routes/agent/chat-conversation')
