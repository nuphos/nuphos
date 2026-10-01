import { Hono } from 'hono'

import { requireCloudflareAccount } from '@/middleware/auth'
import { registerCloudflareAccountRoutes } from '@/routes/cloudflare-accounts/account'
import { registerCloudflareBindRoutes } from '@/routes/cloudflare-accounts/bind'
import { registerCloudflareD1Routes } from '@/routes/cloudflare-accounts/d1'
import { registerCloudflareKvRoutes } from '@/routes/cloudflare-accounts/kv'
import { registerCloudflarePagesRoutes } from '@/routes/cloudflare-accounts/pages'
import { registerCloudflareR2Routes } from '@/routes/cloudflare-accounts/r2'
import { registerCloudflareR2ObjectRoutes } from '@/routes/cloudflare-accounts/r2-objects'
import { registerCloudflareWorkerRoutes } from '@/routes/cloudflare-accounts/workers'

import type { CloudflareAccountVariables, TeamAuthVariables } from '@/middleware/auth'

export { publicView } from '@/routes/cloudflare-accounts/bind'

export const cloudflareAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

registerCloudflareBindRoutes(cloudflareAccountsRoutes)

const accountScoped = new Hono<{ Variables: CloudflareAccountVariables }>()

accountScoped.use('*', requireCloudflareAccount())

registerCloudflareAccountRoutes(accountScoped)
registerCloudflareWorkerRoutes(accountScoped)
registerCloudflareR2Routes(accountScoped)
registerCloudflareR2ObjectRoutes(accountScoped)
registerCloudflarePagesRoutes(accountScoped)
registerCloudflareD1Routes(accountScoped)
registerCloudflareKvRoutes(accountScoped)

cloudflareAccountsRoutes.route('/:accountId', accountScoped)
