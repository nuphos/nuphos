import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/runtime-registry'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/runtime-registry', actual)

await mock.module('@/lib/claude-code-preview/runtime-registry', () => double)
export const useRuntimeRegistry = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/runtime-registry',
)
