import { mock } from 'bun:test'

import * as actual from '@/lib/byos/handles'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/handles', actual)

await mock.module('@/lib/byos/handles', () => double)

export const useByosHandles = makeInstaller<typeof actual>('@/lib/byos/handles')
