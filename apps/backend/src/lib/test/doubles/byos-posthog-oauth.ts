import { mock } from 'bun:test'

import * as actual from '@/lib/byos/posthog-oauth'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/posthog-oauth', actual)

await mock.module('@/lib/byos/posthog-oauth', () => double)

export const useByosPosthogOAuth = makeInstaller<typeof actual>('@/lib/byos/posthog-oauth')
