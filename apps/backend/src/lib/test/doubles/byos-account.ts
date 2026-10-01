import { mock } from 'bun:test'

import * as actual from '@/lib/byos/account'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/account', actual)

await mock.module('@/lib/byos/account', () => double)

export const useByosAccount = makeInstaller<typeof actual>('@/lib/byos/account')
