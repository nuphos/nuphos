import { mock } from 'bun:test'

import * as actual from '@/lib/agent/devices/join-tokens'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/devices/join-tokens', actual)

await mock.module('@/lib/agent/devices/join-tokens', () => double)

export const useJoinTokens = makeInstaller<typeof actual>('@/lib/agent/devices/join-tokens')
