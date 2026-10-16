import { mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import * as actual from '@/lib/oauth/store'

const double = buildDouble('@/lib/oauth/store', actual)

await mock.module('@/lib/oauth/store', () => double)

export const useOauthStore = makeInstaller<typeof actual>('@/lib/oauth/store')
