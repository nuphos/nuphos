import { mock } from 'bun:test'

import * as actual from '@/middleware/auth'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/middleware/auth', actual)

await mock.module('@/middleware/auth', () => double)

export const useAuthMiddleware = makeInstaller<typeof actual>('@/middleware/auth')
