import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/email-otp'

const double = buildDouble('@/lib/email-otp', actual)

await mock.module('@/lib/email-otp', () => double)

export const useEmailOtp = makeInstaller<typeof actual>('@/lib/email-otp')
