import { mock } from 'bun:test'

import * as actual from '@/lib/agent/memory-slots/attribution-capture'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/memory-slots/attribution-capture', actual)

await mock.module('@/lib/agent/memory-slots/attribution-capture', () => double)

export const useAttributionCapture = makeInstaller<typeof actual>(
  '@/lib/agent/memory-slots/attribution-capture',
)
