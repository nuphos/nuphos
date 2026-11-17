import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/upload'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/devices/upload', actual)

await mock.module('@/lib/agent/devices/upload', () => double)

export const useAgentDeviceUpload = makeInstaller<typeof actual>('@/lib/agent/devices/upload')
