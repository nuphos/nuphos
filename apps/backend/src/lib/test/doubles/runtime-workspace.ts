import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/runtime-workspace'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/runtime-workspace', actual)

await mock.module('@/lib/claude-code-preview/runtime-workspace', () => double)
export const useRuntimeWorkspace = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/runtime-workspace',
)
