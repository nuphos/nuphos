import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/box-instabox-create'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/box-instabox-create', actual)

await mock.module('@/lib/agent/devices/box-instabox-create', () => double)

export const useBoxInstaboxCreate = makeInstaller<typeof actual>(
  '@/lib/agent/devices/box-instabox-create',
)
