import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/conversation-runtime-move'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/conversation-runtime-move', actual)

await mock.module('@/lib/claude-code-preview/conversation-runtime-move', () => double)
export const useConversationRuntimeMove = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/conversation-runtime-move',
)
