import { z } from 'zod'

import { userTeamSidebarProjects } from '@/models'
import { sidebarDocumentRoutes } from '@/routes/sidebar-document'

import type { Collection } from 'mongodb'

/** Projects per person per team. */
export const MAX_PROJECTS = 50
/** Chats filed across all of a person's projects: the client prunes chats that are gone. */
export const MAX_FILED_CHATS = 2000

// Session ids are minted by the backend (UUIDs) and by clients, so check the
// shape rather than insist on a UUID.
const sessionIdSchema = z.string().regex(/^[\w-]{1,128}$/, 'Invalid chat id')

const projectSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    sessionIds: z.array(sessionIdSchema).max(MAX_FILED_CHATS),
  })
  .strict()

const replaceSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    projects: z.array(projectSchema).max(MAX_PROJECTS),
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
    if (filed.size > MAX_FILED_CHATS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Projects can hold at most ${String(MAX_FILED_CHATS)} chats in total`,
        path: ['projects'],
      })
    }
  })

// Whole-list replace guarded by a revision, shared with favorites.
export const sidebarProjectsRoutes = sidebarDocumentRoutes({
  field: 'projects',
  collection: () => userTeamSidebarProjects() as unknown as Collection,
  schema: replaceSchema,
  conflict: {
    code: 'sidebar_projects_changed',
    message: 'Projects changed concurrently; refresh and retry',
  },
})
