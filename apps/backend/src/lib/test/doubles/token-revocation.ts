import { mock } from 'bun:test'

import * as actual from '@/lib/internal-token/revocation'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/internal-token/revocation', actual)

await mock.module('@/lib/internal-token/revocation', () => double)

export const useTokenRevocation = makeInstaller<typeof actual>('@/lib/internal-token/revocation')
