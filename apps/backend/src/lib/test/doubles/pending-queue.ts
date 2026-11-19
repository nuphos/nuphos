import { mock } from 'bun:test'

import * as actual from '@/lib/agent/pending-queue'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/pending-queue', actual)

await mock.module('@/lib/agent/pending-queue', () => double)

export const usePendingQueue = makeInstaller<typeof actual>('@/lib/agent/pending-queue')
