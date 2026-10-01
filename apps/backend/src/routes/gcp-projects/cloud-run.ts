import { gcpCloudRunServicePathSchema } from '@/lib/api/credentials'
import {
  getCloudRunService,
  listCloudRunRevisions,
  listCloudRunServices,
} from '@/lib/byos/gcp-cloud-run'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { handleFor } from './handle'

import type { GcpUpstreamError } from '@/lib/byos/gcp-cloud-run'
import type { GcpProjectVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

function translateCloudRunError(
  e: unknown,
  handle: { projectId: string; serviceAccountEmail: string },
  notFoundMessage?: string,
): never {
  const err = e as Partial<GcpUpstreamError> & { code?: number }
  // GCP usually echoes `project` in error metadata (consumer/containerInfo),
  // but fall back to the bound projectId so the UI can always link to IAM.
  const project = err.project ?? handle.projectId

  if (err?.reason === 'SERVICE_DISABLED') {
    throw new AppError(502, 'cloud_run_api_disabled', err.message ?? 'Cloud Run API is disabled.', {
      activationUrl: err.activationUrl,
      project,
      service: err.service ?? 'run.googleapis.com',
      serviceTitle: err.serviceTitle ?? 'Cloud Run Admin API',
      serviceAccountEmail: handle.serviceAccountEmail,
    })
  }
  // Only route to the IAM-specific UX (Fix-with-Agent etc.) when the 403 is
  // actually an IAM permission denial — either GCP explicitly tagged it as
  // such, or we parsed a concrete `permission` out of the message. Other 403s
  // (org policy, quota, VPC SC, …) fall through to the generic upstream
  // error so the UI doesn't push the user toward an IAM grant that won't help.
  const isIamPermissionDenied =
    err?.reason === 'IAM_PERMISSION_DENIED' ||
    ((err?.upstreamStatus === 403 || err?.code === 403) &&
      typeof err?.permission === 'string' &&
      err.permission.length > 0)

  if (isIamPermissionDenied) {
    throw new AppError(
      403,
      'cloud_run_permission_denied',
      err.message ?? 'Permission denied when calling the Cloud Run API.',
      {
        reason: err.reason ?? null,
        project,
        serviceAccountEmail: handle.serviceAccountEmail,
        permission: err.permission,
        resource: err.resource,
      },
    )
  }
  if (err?.code === 5 && notFoundMessage) {
    throw new AppError(404, 'cloud_run_service_not_found', notFoundMessage)
  }
  throw e
}

export function registerGcpCloudRunRoutes(
  projectScoped: Hono<{ Variables: GcpProjectVariables }>,
): void {
  projectScoped.get('/cloud-run-services', async (c) => {
    const handle = handleFor(c)

    try {
      const services = await listCloudRunServices(handle)

      return c.json({ services })
    } catch (e) {
      translateCloudRunError(e, handle)
    }
  })

  projectScoped.get(
    '/cloud-run-services/:region/:name',
    zv('param', gcpCloudRunServicePathSchema),
    async (c) => {
      const { region, name } = c.req.valid('param')
      const handle = handleFor(c)

      try {
        const service = await getCloudRunService(handle, region, name)

        if (!service) {
          throw new AppError(
            404,
            'cloud_run_service_not_found',
            `Cloud Run service ${name} not found in ${region}`,
          )
        }

        return c.json(service)
      } catch (e) {
        if (e instanceof AppError) throw e
        translateCloudRunError(e, handle, `Cloud Run service ${name} not found in ${region}`)
      }
    },
  )

  projectScoped.get(
    '/cloud-run-services/:region/:name/revisions',
    zv('param', gcpCloudRunServicePathSchema),
    async (c) => {
      const { region, name } = c.req.valid('param')
      const handle = handleFor(c)

      try {
        const revisions = await listCloudRunRevisions(handle, region, name)

        return c.json({ revisions })
      } catch (e) {
        translateCloudRunError(e, handle, `Cloud Run service ${name} not found in ${region}`)
      }
    },
  )
}
