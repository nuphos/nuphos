import { mock } from 'bun:test'

import * as actual from '@/lib/byos/relay-token'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/relay-token', actual)

await mock.module('@/lib/byos/relay-token', () => double)

export const useRelayToken = makeInstaller<typeof actual>('@/lib/byos/relay-token')
