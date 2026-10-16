import { Hono } from 'hono'
import { MongoServerError, ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Collection, Document } from 'mongodb'
import type { z } from 'zod'

type Snapshot<Field extends string, Item> = Record<Field, Item[]> & {
  revision: number
  updatedAt: string | null
}

/**
 * Routes for one person's revisioned sidebar list in one team, such as favorites or
 * projects. GET reads it; PUT replaces the whole list only if `expectedRevision`
 * still matches, else answers 409 with the current snapshot for the client to replay onto.
 */
export function sidebarDocumentRoutes<Field extends string, Item>(options: {
  field: Field
  collection: () => Collection
  schema: z.ZodType<{ expectedRevision: number } & Record<Field, Item[]>>
  conflict: { code: string; message: string }
}) {
  const { field, collection, schema, conflict } = options
  const routes = new Hono<{ Variables: TeamAuthVariables }>()

  function serialize(doc: Document | null): Snapshot<Field, Item> {
    return {
      [field]: (doc?.[field] as Item[] | undefined) ?? [],
      revision: (doc?.revision as number | undefined) ?? 0,
      updatedAt: (doc?.updatedAt as Date | undefined)?.toISOString() ?? null,
    } as Snapshot<Field, Item>
  }

  routes.get('/', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const doc = await collection().findOne({ teamId, userId: c.get('userId') })

    return c.json(serialize(doc))
  })

  routes.put('/', zv('json', schema), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const userId = c.get('userId')
    const body = c.req.valid('json') as { expectedRevision: number } & Record<Field, Item[]>
    const items = body[field]
    const now = new Date()
    let saved: Document | null = null

    if (body.expectedRevision === 0) {
      const doc = {
        _id: new ObjectId(),
        teamId,
        userId,
        [field]: items,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }

      try {
        await collection().insertOne(doc)
        saved = doc
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000) throw error
      }
    } else {
      saved = await collection().findOneAndUpdate(
        { teamId, userId, revision: body.expectedRevision },
        { $set: { [field]: items, updatedAt: now }, $inc: { revision: 1 } },
        { returnDocument: 'after' },
      )
    }
    if (!saved) {
      const current = await collection().findOne({ teamId, userId })

      throw new AppError(409, conflict.code, conflict.message, serialize(current))
    }

    return c.json(serialize(saved))
  })

  return routes
}
