import { ObjectId } from 'mongodb'
import { z } from 'zod'

import {
  credentialsFromSonarqubeBinding,
  getSonarqubeMeasures,
  getSonarqubeProjectReport,
  getSonarqubeQualityGate,
  getSonarqubeTask,
  listSonarqubeAnalyses,
  listSonarqubeHotspots,
  listSonarqubeIssues,
  listSonarqubeProjects,
} from '@/lib/byos/sonarqube'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireSonarqubeMemberAccess, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { mapSonarqubeError, sonarqubePublicView } from '@/routes/sonarqube-integrations/shared'

import type { SonarqubeIntegrationVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const projectKey = z.string().trim().min(1).max(400)
const scopeShape = {
  projectKey,
  branch: z.string().trim().min(1).max(400).optional(),
  pullRequest: z.string().trim().min(1).max(200).optional(),
}
const validateScope = (value: { branch?: string; pullRequest?: string }, ctx: z.RefinementCtx) => {
  if (value.branch && value.pullRequest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'branch and pullRequest are mutually exclusive',
    })
  }
}
const scopeSchema = z.object(scopeShape).strict().superRefine(validateScope)
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
})

export function registerSonarqubeScopedRoutes(
  scoped: Hono<{ Variables: SonarqubeIntegrationVariables }>,
) {
  scoped.get('/', requireSonarqubeMemberAccess(), (c) =>
    c.json(sonarqubePublicView(c.get('sonarqubeBinding'))),
  )

  scoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const result = await teamByosBindings().updateOne(
      { _id: parseObjectId(c.get('teamId'), 'teamId') },
      {
        $pull: { sonarqubeIntegrations: { id: new ObjectId(c.get('sonarqubeIntegrationId')) } },
        $set: { updatedAt: new Date() },
      },
    )

    if (result.modifiedCount === 0) {
      throw new AppError(404, 'sonarqube_integration_not_bound', 'SonarQube integration not found')
    }

    return c.body(null, 204)
  })

  scoped.get(
    '/projects',
    requireSonarqubeMemberAccess(),
    zv(
      'query',
      pageSchema.extend({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    ),
    async (c) => {
      const { page, pageSize, q } = c.req.valid('query')

      return c.json(
        await listSonarqubeProjects(credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')), {
          page,
          pageSize,
          query: q,
        }).catch((err: unknown) => {
          throw mapSonarqubeError(err)
        }),
      )
    },
  )

  scoped.get(
    '/issues',
    requireSonarqubeMemberAccess(),
    zv(
      'query',
      pageSchema
        .extend(scopeShape)
        .extend({
          resolved: z.enum(['true', 'false']).default('false'),
          types: z.string().trim().min(1).max(200).optional(),
          severities: z.string().trim().min(1).max(200).optional(),
        })
        .superRefine(validateScope),
    ),
    async (c) => {
      const input = c.req.valid('query')

      return c.json(
        await listSonarqubeIssues(credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')), {
          ...input,
          resolved: input.resolved === 'true',
        }).catch((err: unknown) => {
          throw mapSonarqubeError(err)
        }),
      )
    },
  )

  scoped.get(
    '/hotspots',
    requireSonarqubeMemberAccess(),
    zv(
      'query',
      pageSchema
        .extend(scopeShape)
        .extend({
          status: z.string().trim().min(1).max(100).optional(),
        })
        .superRefine(validateScope),
    ),
    async (c) => {
      const input = c.req.valid('query')

      return c.json(
        await listSonarqubeHotspots(
          credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')),
          input,
        ).catch((err: unknown) => {
          throw mapSonarqubeError(err)
        }),
      )
    },
  )

  scoped.get('/quality-gate', requireSonarqubeMemberAccess(), zv('query', scopeSchema), async (c) =>
    c.json(
      await getSonarqubeQualityGate(
        credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')),
        c.req.valid('query'),
      ).catch((err: unknown) => {
        throw mapSonarqubeError(err)
      }),
    ),
  )

  scoped.get('/measures', requireSonarqubeMemberAccess(), zv('query', scopeSchema), async (c) =>
    c.json(
      await getSonarqubeMeasures(
        credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')),
        c.req.valid('query'),
      ).catch((err: unknown) => {
        throw mapSonarqubeError(err)
      }),
    ),
  )

  scoped.get(
    '/analyses',
    requireSonarqubeMemberAccess(),
    zv(
      'query',
      z
        .object({
          projectKey,
          branch: z.string().trim().min(1).max(400).optional(),
          pageSize: z.coerce.number().int().min(1).max(500).default(20),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await listSonarqubeAnalyses(
          credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')),
          c.req.valid('query'),
        ).catch((err: unknown) => {
          throw mapSonarqubeError(err)
        }),
      ),
  )

  scoped.get('/report', requireSonarqubeMemberAccess(), zv('query', scopeSchema), async (c) =>
    c.json(
      await getSonarqubeProjectReport(
        credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')),
        c.req.valid('query'),
      ).catch((err: unknown) => {
        throw mapSonarqubeError(err)
      }),
    ),
  )

  scoped.get('/tasks/:taskId', requireSonarqubeMemberAccess(), async (c) => {
    const taskId = c.req.param('taskId')?.trim()

    if (!taskId || taskId.length > 200)
      throw new AppError(400, 'invalid_task_id', 'taskId is required')

    return c.json(
      await getSonarqubeTask(
        credentialsFromSonarqubeBinding(c.get('sonarqubeBinding')),
        taskId,
      ).catch((err: unknown) => {
        throw mapSonarqubeError(err)
      }),
    )
  })
}
