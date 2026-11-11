import { Hono } from 'hono'
import { z } from 'zod'

import { handleFor } from './handle'

import type { GcpProjectVariables } from '@/middleware/auth'

import { firebaseGet } from '@/lib/byos/gcp-firebase'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

export const firebaseRoutes = new Hono<{ Variables: GcpProjectVariables }>()

firebaseRoutes.use('*', async (c, next) => {
  if (c.get('gcpBinding').purpose === 'permission-admin') {
    throw new AppError(
      403,
      'permission_admin_no_firebase_access',
      'Use an ordinary GCP service account for Firebase.',
    )
  }
  await next()
})
firebaseRoutes.get('/project', async (c) => c.json(await firebaseGet(handleFor(c), 'project')))
firebaseRoutes.get(
  '/apps',
  zv('query', z.object({ pageToken: z.string().max(4096).optional() })),
  async (c) => {
    return c.json(await firebaseGet(handleFor(c), 'apps', c.req.valid('query').pageToken))
  },
)
