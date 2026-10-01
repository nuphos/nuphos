import { mock } from 'bun:test'

import * as actual from '@/lib/posthog'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/posthog', actual)

await mock.module('@/lib/posthog', () => double)

export const usePosthog = makeInstaller<typeof actual>('@/lib/posthog')
