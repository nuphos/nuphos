import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/box-usage-history'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/box-usage-history', actual)

await mock.module('@/lib/agent/devices/box-usage-history', () => double)

export const useBoxUsageHistory = makeInstaller<typeof actual>(
  '@/lib/agent/devices/box-usage-history',
)
