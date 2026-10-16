import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/byos/credential-role'

const double = buildDouble('@/lib/byos/credential-role', actual)

await mock.module('@/lib/byos/credential-role', () => double)

export const useCredentialRole = makeInstaller<typeof actual>('@/lib/byos/credential-role')
