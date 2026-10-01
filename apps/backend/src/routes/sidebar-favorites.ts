import { Hono } from 'hono'
import { MongoServerError, ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { userTeamSidebarFavorites } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { UserTeamSidebarFavorites } from '@/models'

export const sidebarFavoritesRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const favoriteSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    key: z.string().trim().min(1).max(512).optional(),
    href: z.string().trim().min(1).max(4096).optional(),
  })
  .strict()
  .refine((entry) => Number(entry.key !== undefined) + Number(entry.href !== undefined) === 1, {
    message: 'Exactly one of key or href is required',
  })

const replaceSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    entries: z.array(favoriteSchema).max(1000),
  })
  .strict()
  .superRefine(({ entries }, ctx) => {
    const identities = new Set<string>()

    for (const [index, entry] of entries.entries()) {
      const identity = entry.key ?? `fav-href:${entry.href ?? ''}`

      if (identities.has(identity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Favorite identities must be unique',
          path: ['entries', index],
        })
      }
      identities.add(identity)
    }
  })

function serializeFavorites(doc: UserTeamSidebarFavorites | null) {
  return {
    entries: doc?.entries ?? [],
    revision: doc?.revision ?? 0,
    updatedAt: doc?.updatedAt.toISOString() ?? null,
  }
}

sidebarFavoritesRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const userId = c.get('userId')
  const doc = await userTeamSidebarFavorites().findOne({ teamId, userId })

  return c.json(serializeFavorites(doc))
})

sidebarFavoritesRoutes.put('/', zv('json', replaceSchema), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const userId = c.get('userId')
  const { entries, expectedRevision } = c.req.valid('json')
  const collection = userTeamSidebarFavorites()
  const now = new Date()
  let saved: UserTeamSidebarFavorites | null = null

  if (expectedRevision === 0) {
    const doc: UserTeamSidebarFavorites = {
      _id: new ObjectId(),
      teamId,
      userId,
      entries,
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
      {
        $set: { entries, updatedAt: now },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    )
  }

  if (!saved) {
    const current = await collection.findOne({ teamId, userId })

    throw new AppError(
      409,
      'sidebar_favorites_changed',
      'Favorites changed concurrently; refresh and retry',
      serializeFavorites(current),
    )
  }

  return c.json(serializeFavorites(saved))
})
