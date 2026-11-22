import { mock } from 'bun:test'

import * as actual from '@/lib/agent/archive-cleanup'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/archive-cleanup', actual)

await mock.module('@/lib/agent/archive-cleanup', () => double)

export const useArchiveCleanup = makeInstaller<typeof actual>('@/lib/agent/archive-cleanup')
