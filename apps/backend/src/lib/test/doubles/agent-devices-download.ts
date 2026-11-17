import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/download'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/devices/download', actual)

await mock.module('@/lib/agent/devices/download', () => double)

export const useAgentDeviceDownload = makeInstaller<typeof actual>('@/lib/agent/devices/download')
