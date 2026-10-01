import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/store'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/store', actual)

await mock.module('@/lib/agent/devices/store', () => double)

export const useAgentDeviceStore = makeInstaller<typeof actual>('@/lib/agent/devices/store')
