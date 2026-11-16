import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/conversation-computer'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/devices/conversation-computer', actual)

await mock.module('@/lib/agent/devices/conversation-computer', () => double)

export const useConversationComputer = makeInstaller<typeof actual>(
  '@/lib/agent/devices/conversation-computer',
)
