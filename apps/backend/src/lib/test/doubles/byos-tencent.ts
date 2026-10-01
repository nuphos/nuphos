import { mock } from 'bun:test'

import * as actual from '@/lib/byos/tencent'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/tencent', actual)

await mock.module('@/lib/byos/tencent', () => double)

export const useByosTencent = makeInstaller<typeof actual>('@/lib/byos/tencent')
