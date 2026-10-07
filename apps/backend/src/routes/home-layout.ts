import { Hono } from 'hono'
import { z } from 'zod'

import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamHomeLayouts } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'

/**
 * The cards on a team's home page. Each member's layout follows them across
 * machines; an administrator can set a team default for members who have not
 * customized theirs. A `null` layout removes the saved one.
 */
export const homeLayoutRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const repoSchema = z
  .object({ installationId: z.number().int().positive(), fullName: z.string().min(3).max(200) })
  .strict()

const layoutSchema = z
  .object({
    team: z.boolean(),
    github: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              id: z.string().min(1).max(40),
              kind: z.literal('pulls'),
              repos: z.array(repoSchema).max(50),
              status: z.enum(['open', 'ready', 'draft']),
            })
            .strict(),
          z
            .object({
              id: z.string().min(1).max(40),
              kind: z.literal('ci'),
              repos: z.array(repoSchema).max(50),
              status: z.enum(['failed', 'running', 'latest']),
            })
            .strict(),
        ]),
      )
      .max(30),
    panels: z
      .array(
        z
          .object({ dashboardId: z.string().min(1).max(64), panelId: z.string().min(1).max(64) })
          .strict(),
      )
      .max(50),
    grid: z
      .array(
        z
          .object({
            i: z.string().min(1).max(200),
            x: z.number().int().min(0).max(100),
            y: z.number().int().min(0).max(1000),
            w: z.number().int().min(1).max(100),
            h: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict()

const putSchema = z.object({ layout: layoutSchema.nullable() }).strict()

async function saveLayout(
  teamIdHex: string,
  userId: string | null,
  layout: z.infer<typeof layoutSchema> | null,
) {
  const teamId = parseObjectId(teamIdHex, 'teamId')

  if (layout === null) {
    await teamHomeLayouts().deleteOne({ teamId, userId })
  } else {
    await teamHomeLayouts().updateOne(
      { teamId, userId },
      { $set: { layout, updatedAt: new Date() } },
      { upsert: true },
    )
  }
}

homeLayoutRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const docs = await teamHomeLayouts()
    .find({ teamId, userId: { $in: [c.get('userId'), null] } })
    .toArray()

  return c.json({
    personal: docs.find((d) => d.userId !== null)?.layout ?? null,
    team: docs.find((d) => d.userId === null)?.layout ?? null,
  })
})

homeLayoutRoutes.put('/personal', zv('json', putSchema), async (c) => {
  await saveLayout(c.get('teamId'), c.get('userId'), c.req.valid('json').layout)

  return c.body(null, 204)
})

homeLayoutRoutes.put(
  '/team',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', putSchema),
  async (c) => {
    await saveLayout(c.get('teamId'), null, c.req.valid('json').layout)

    return c.body(null, 204)
  },
)
