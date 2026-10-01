import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/session-execution-state'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/session-execution-state', actual)

await mock.module('@/lib/claude-code-preview/session-execution-state', () => double)

export const useSessionExecutionState = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/session-execution-state',
)
