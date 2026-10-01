import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/conversation-chat-route'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/conversation-chat-route', actual)

await mock.module('@/lib/claude-code-preview/conversation-chat-route', () => double)

export const useConversationChatRoute = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/conversation-chat-route',
)
