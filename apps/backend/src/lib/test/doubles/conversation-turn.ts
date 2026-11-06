import { mock } from 'bun:test'

import * as actual from '@/lib/agent/conversation-turn'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/conversation-turn', actual)

await mock.module('@/lib/agent/conversation-turn', () => double)

export const useConversationTurn = makeInstaller<typeof actual>('@/lib/agent/conversation-turn')
