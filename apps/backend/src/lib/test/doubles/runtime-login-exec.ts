import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/runtime-login-exec'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/runtime-login-exec', actual)

await mock.module('@/lib/claude-code-preview/runtime-login-exec', () => double)

export const useRuntimeLoginExec = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/runtime-login-exec',
)
