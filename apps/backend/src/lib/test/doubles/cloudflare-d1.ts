import { mock } from 'bun:test'

import * as actual from '@/lib/byos/cloudflare-d1'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/cloudflare-d1', actual)

await mock.module('@/lib/byos/cloudflare-d1', () => double)

export const useCloudflareD1 = makeInstaller<typeof actual>('@/lib/byos/cloudflare-d1')
