import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/identity/sessions'

const double = buildDouble('@/lib/identity/sessions', actual)

await mock.module('@/lib/identity/sessions', () => double)

export const useIdentitySessions = makeInstaller<typeof actual>('@/lib/identity/sessions')
