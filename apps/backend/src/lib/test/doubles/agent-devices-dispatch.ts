import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/dispatch'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/dispatch', actual)

await mock.module('@/lib/agent/devices/dispatch', () => double)

export const useAgentDeviceDispatch = makeInstaller<typeof actual>('@/lib/agent/devices/dispatch')
