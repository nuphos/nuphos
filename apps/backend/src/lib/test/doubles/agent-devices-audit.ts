import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/audit'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/audit', actual)

await mock.module('@/lib/agent/devices/audit', () => double)

export const useAgentDeviceAudit = makeInstaller<typeof actual>('@/lib/agent/devices/audit')
