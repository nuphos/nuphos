import { mock } from 'bun:test'

import * as actual from '@/lib/agent/thread-runtime'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/thread-runtime', actual)

await mock.module('@/lib/agent/thread-runtime', () => double)

export const useThreadRuntime = makeInstaller<typeof actual>('@/lib/agent/thread-runtime')
