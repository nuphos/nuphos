import { mock } from 'bun:test'

import * as actual from '@/lib/byos/huawei'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/huawei', actual)

await mock.module('@/lib/byos/huawei', () => double)

export const useByosHuawei = makeInstaller<typeof actual>('@/lib/byos/huawei')
