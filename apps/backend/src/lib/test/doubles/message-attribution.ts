import { mock } from 'bun:test'

import * as actual from '@/lib/agent/message-attribution'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/message-attribution', actual)

await mock.module('@/lib/agent/message-attribution', () => double)

export const useMessageAttribution = makeInstaller<typeof actual>('@/lib/agent/message-attribution')
