import { mock } from 'bun:test'

import * as actual from '@/lib/byos/aws'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/aws', actual)

await mock.module('@/lib/byos/aws', () => double)

export const useByosAws = makeInstaller<typeof actual>('@/lib/byos/aws')
