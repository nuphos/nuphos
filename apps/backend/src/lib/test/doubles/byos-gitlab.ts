import { mock } from 'bun:test'

import * as actual from '@/lib/byos/gitlab'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/byos/gitlab', actual)

await mock.module('@/lib/byos/gitlab', () => double)
export const useByosGitlab = makeInstaller<typeof actual>('@/lib/byos/gitlab')
