import { mock } from 'bun:test'

import * as actual from '@/lib/byos/gcp'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/gcp', actual)

await mock.module('@/lib/byos/gcp', () => double)

export const useByosGcp = makeInstaller<typeof actual>('@/lib/byos/gcp')
