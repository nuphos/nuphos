import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/box-instabox-account'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/box-instabox-account', actual)

await mock.module('@/lib/agent/devices/box-instabox-account', () => double)

export const useBoxInstaboxAccount = makeInstaller<typeof actual>(
  '@/lib/agent/devices/box-instabox-account',
)
