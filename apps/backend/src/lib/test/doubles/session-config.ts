import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/session-config'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/session-config', actual)

await mock.module('@/lib/claude-code-preview/session-config', () => double)

export const useSessionConfig = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/session-config',
)
