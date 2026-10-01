import { mock } from 'bun:test'

import * as actual from '@/lib/agent/memory-slots/ingest-dispatch'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/memory-slots/ingest-dispatch', actual)

await mock.module('@/lib/agent/memory-slots/ingest-dispatch', () => double)

export const useMemoryIngestDispatch = makeInstaller<typeof actual>(
  '@/lib/agent/memory-slots/ingest-dispatch',
)
