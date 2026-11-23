import { mock } from 'bun:test'

import * as actual from '@/lib/webhooks/store'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/webhooks/store', actual)

await mock.module('@/lib/webhooks/store', () => double)

export const useWebhooksStore = makeInstaller<typeof actual>('@/lib/webhooks/store')
