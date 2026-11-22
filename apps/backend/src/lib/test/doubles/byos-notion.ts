import { mock } from 'bun:test'

import * as actual from '@/lib/byos/notion'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/notion', actual)

await mock.module('@/lib/byos/notion', () => double)

export const useByosNotion = makeInstaller<typeof actual>('@/lib/byos/notion')
