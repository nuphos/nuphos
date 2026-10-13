import { mock } from 'bun:test'

import * as actual from '@/lib/byos/github'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/byos/github', actual)

await mock.module('@/lib/byos/github', () => double)
export const useByosGithub = makeInstaller<typeof actual>('@/lib/byos/github')
