import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/runtime-catalog'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/runtime-catalog', actual)

await mock.module('@/lib/claude-code-preview/runtime-catalog', () => double)
export const useRuntimeCatalog = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/runtime-catalog',
)
