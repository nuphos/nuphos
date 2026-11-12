import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/runtime-models'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/runtime-models', actual)

await mock.module('@/lib/claude-code-preview/runtime-models', () => double)
export const useRuntimeModels = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/runtime-models',
)
