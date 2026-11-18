import { mock } from 'bun:test'

import * as actual from '@/lib/agent/pending-messages'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/pending-messages', actual)

await mock.module('@/lib/agent/pending-messages', () => double)

export const usePendingMessages = makeInstaller<typeof actual>('@/lib/agent/pending-messages')
