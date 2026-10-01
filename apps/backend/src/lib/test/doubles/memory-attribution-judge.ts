import { mock } from 'bun:test'

import * as actual from '@/lib/agent/memory-slots/attribution-judge'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/memory-slots/attribution-judge', actual)

await mock.module('@/lib/agent/memory-slots/attribution-judge', () => double)

export const useAttributionJudge = makeInstaller<typeof actual>(
  '@/lib/agent/memory-slots/attribution-judge',
)
