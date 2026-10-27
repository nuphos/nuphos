import { mock } from 'bun:test'

import * as actual from '@/lib/byos/uptime-kuma'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/byos/uptime-kuma', actual)

await mock.module('@/lib/byos/uptime-kuma', () => double)

export const useByosUptimeKuma = makeInstaller<typeof actual>('@/lib/byos/uptime-kuma')
