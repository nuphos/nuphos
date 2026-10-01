import { mock } from 'bun:test'

import * as actual from '@/routes/agent-sessions/shared'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/routes/agent-sessions/shared', actual)

await mock.module('@/routes/agent-sessions/shared', () => double)

export const useAgentSessionsShared = makeInstaller<typeof actual>('@/routes/agent-sessions/shared')
