import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/email'

const double = buildDouble('@/lib/email', actual)

await mock.module('@/lib/email', () => double)

export const useEmail = makeInstaller<typeof actual>('@/lib/email')
