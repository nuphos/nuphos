import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/box-update'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/box-update', actual)

await mock.module('@/lib/claude-code-preview/box-update', () => double)
export const useBoxUpdate = makeInstaller<typeof actual>('@/lib/claude-code-preview/box-update')
