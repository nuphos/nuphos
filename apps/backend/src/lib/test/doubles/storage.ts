import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/storage'

const double = buildDouble('@/lib/storage', actual)

await mock.module('@/lib/storage', () => double)

export const useStorage = makeInstaller<typeof actual>('@/lib/storage')
