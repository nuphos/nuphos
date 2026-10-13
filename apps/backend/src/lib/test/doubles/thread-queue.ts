import { mock } from 'bun:test'

import * as actual from '@/lib/agent/thread-queue'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/thread-queue', actual)

await mock.module('@/lib/agent/thread-queue', () => double)

export const useThreadQueue = makeInstaller<typeof actual>('@/lib/agent/thread-queue')
