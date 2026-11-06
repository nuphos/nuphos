import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/box-instabox'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/box-instabox', actual)

await mock.module('@/lib/agent/devices/box-instabox', () => double)

export const useBoxInstabox = makeInstaller<typeof actual>('@/lib/agent/devices/box-instabox')
