import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/instabox-machines'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/instabox-machines', actual)

await mock.module('@/lib/agent/devices/instabox-machines', () => double)

export const useInstaboxMachines = makeInstaller<typeof actual>(
  '@/lib/agent/devices/instabox-machines',
)
