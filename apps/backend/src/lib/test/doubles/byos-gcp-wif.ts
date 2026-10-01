import { mock } from 'bun:test'

import * as actual from '@/lib/byos/gcp-wif'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/gcp-wif', actual)

await mock.module('@/lib/byos/gcp-wif', () => double)

export const useByosGcpWif = makeInstaller<typeof actual>('@/lib/byos/gcp-wif')
