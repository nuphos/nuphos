import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/identity/webauthn'

const double = buildDouble('@/lib/identity/webauthn', actual)

await mock.module('@/lib/identity/webauthn', () => double)

export const useWebAuthn = makeInstaller<typeof actual>('@/lib/identity/webauthn')
