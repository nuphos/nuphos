import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/box-instabox-resize'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/box-instabox-resize', actual)

await mock.module('@/lib/agent/devices/box-instabox-resize', () => double)

export const useBoxInstaboxResize = makeInstaller<typeof actual>(
  '@/lib/agent/devices/box-instabox-resize',
)
