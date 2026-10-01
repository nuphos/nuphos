import { mock } from 'bun:test'

import * as actual from '@/lib/agent/title-generator'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/title-generator', actual)

await mock.module('@/lib/agent/title-generator', () => double)

export const useTitleGenerator = makeInstaller<typeof actual>('@/lib/agent/title-generator')
