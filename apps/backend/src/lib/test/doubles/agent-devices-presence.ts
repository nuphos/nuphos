import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/presence'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/presence', actual)

await mock.module('@/lib/agent/devices/presence', () => double)

export const useAgentDevicePresence = makeInstaller<typeof actual>('@/lib/agent/devices/presence')
