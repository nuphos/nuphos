import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/local-runtime/presence'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/devices/local-runtime/presence', actual)

await mock.module('@/lib/agent/devices/local-runtime/presence', () => double)

export const useLocalRuntimePresence = makeInstaller<typeof actual>(
  '@/lib/agent/devices/local-runtime/presence',
)
