import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/download-handoff-rate-limit'

const double = buildDouble('@/lib/download-handoff-rate-limit', actual)

await mock.module('@/lib/download-handoff-rate-limit', () => double)

export const useDownloadHandoffRateLimit = makeInstaller<typeof actual>(
  '@/lib/download-handoff-rate-limit',
)
