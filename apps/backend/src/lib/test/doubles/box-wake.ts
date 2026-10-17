import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/box-wake'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/devices/box-wake', actual)

await mock.module('@/lib/agent/devices/box-wake', () => double)
export const useBoxWake = makeInstaller<typeof actual>('@/lib/agent/devices/box-wake')
