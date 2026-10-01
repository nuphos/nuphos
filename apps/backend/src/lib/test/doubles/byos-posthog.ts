import { mock } from 'bun:test'

import * as actual from '@/lib/byos/posthog'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/posthog', actual)

await mock.module('@/lib/byos/posthog', () => double)

export const useByosPosthog = makeInstaller<typeof actual>('@/lib/byos/posthog')
