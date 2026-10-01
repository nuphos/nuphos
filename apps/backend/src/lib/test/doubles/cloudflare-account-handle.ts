import { mock } from 'bun:test'

import * as actual from '@/lib/byos/cloudflare-account-handle'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/cloudflare-account-handle', actual)

await mock.module('@/lib/byos/cloudflare-account-handle', () => double)

export const useCloudflareAccountHandle = makeInstaller<typeof actual>(
  '@/lib/byos/cloudflare-account-handle',
)
