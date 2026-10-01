import { mock } from 'bun:test'

import * as actual from '@/lib/redis'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/redis', actual)

await mock.module('@/lib/redis', () => double)

export const useRedis = makeInstaller<typeof actual>('@/lib/redis')
