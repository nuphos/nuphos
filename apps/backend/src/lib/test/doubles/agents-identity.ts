import { mock } from 'bun:test'

import * as actual from '@/lib/agents/identity'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agents/identity', actual)

await mock.module('@/lib/agents/identity', () => double)

export const useAgentsIdentity = makeInstaller<typeof actual>('@/lib/agents/identity')
