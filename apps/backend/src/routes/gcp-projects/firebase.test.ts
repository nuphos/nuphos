import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { firebaseRoutes } from './firebase'

import type { GcpProjectVariables } from '@/middleware/auth'

import { errorHandler } from '@/lib/errors'

test('permission-admin bindings cannot use either Firebase route', async () => {
  const app = new Hono<{ Variables: GcpProjectVariables }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('gcpBinding', { purpose: 'permission-admin' } as never)
    await next()
  })
  app.route('/firebase', firebaseRoutes)
  for (const path of ['/firebase/project', '/firebase/apps']) {
    const response = await app.request(path)

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('permission_admin_no_firebase_access')
  }
})
