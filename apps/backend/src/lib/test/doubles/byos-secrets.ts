import { mock } from 'bun:test'

import * as actual from '@/lib/byos/secrets'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/secrets', actual)

await mock.module('@/lib/byos/secrets', () => double)

export const useByosSecrets = makeInstaller<typeof actual>('@/lib/byos/secrets')
