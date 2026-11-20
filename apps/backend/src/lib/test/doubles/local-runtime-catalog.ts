import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/local-runtime-catalog'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/local-runtime-catalog', actual)

await mock.module('@/lib/claude-code-preview/local-runtime-catalog', () => double)
export const useLocalRuntimeCatalog = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/local-runtime-catalog',
)
