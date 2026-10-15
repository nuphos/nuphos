import { Hono } from 'hono'
import { MongoServerError, ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { userTeamSidebarProjects } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { UserTeamSidebarProjects } from '@/models'

export const sidebarProjectsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const projectSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    sessionIds: z.array(z.string().trim().min(1).max(128)).max(1000),
    manualOrder: z.boolean().optional(),
  })
  .strict()

const replaceSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    projects: z.array(projectSchema).max(100),
  })
  .strict()
  .superRefine(({ projects }, ctx) => {
    const ids = new Set<string>()
    const filed = new Set<string>()

    for (const [index, project] of projects.entries()) {
      if (ids.has(project.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Project ids must be unique',
          path: ['projects', index, 'id'],
        })
      }
      ids.add(project.id)
      for (const sessionId of project.sessionIds) {
        if (filed.has(sessionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A chat can be in only one project',
            path: ['projects', index, 'sessionIds'],
          })
        }
        filed.add(sessionId)
      }
    }
  })

function serializeProjects(doc: UserTeamSidebarProjects | null) {
  return {
    projects: doc?.projects ?? [],
    revision: doc?.revision ?? 0,
    updatedAt: doc?.updatedAt.toISOString() ?? null,
  }
}

sidebarProjectsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await userTeamSidebarProjects().findOne({ teamId, userId: c.get('userId') })

  return c.json(serializeProjects(doc))
})

// Whole-list replace guarded by a revision, the same contract as favorites.
sidebarProjectsRoutes.put('/', zv('json', replaceSchema), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const userId = c.get('userId')
  const { projects, expectedRevision } = c.req.valid('json')
  const collection = userTeamSidebarProjects()
  const now = new Date()
  let saved: UserTeamSidebarProjects | null = null

  if (expectedRevision === 0) {
    const doc: UserTeamSidebarProjects = {
      _id: new ObjectId(),
      teamId,
      userId,
      projects,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }

    try {
      await collection.insertOne(doc)
      saved = doc
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error
    }
  } else {
    saved = await collection.findOneAndUpdate(
      { teamId, userId, revision: expectedRevision },
      { $set: { projects, updatedAt: now }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    )
  }

  if (!saved) {
    const current = await collection.findOne({ teamId, userId })

    throw new AppError(
      409,
      'sidebar_projects_changed',
      'Projects changed concurrently; refresh and retry',
      serializeProjects(current),
    )
  }

  return c.json(serializeProjects(saved))
})
