import { Hono } from 'hono'

import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'

export const agent = new Hono<{ Variables: AuthVariables }>()

agent.use('*', requireAuth)
