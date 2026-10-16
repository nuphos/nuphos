import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/box-instabox-limit'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/box-instabox-limit', actual)

await mock.module('@/lib/agent/devices/box-instabox-limit', () => double)

export const useBoxInstaboxLimit = makeInstaller<typeof actual>(
  '@/lib/agent/devices/box-instabox-limit',
)
