import { z } from 'zod'

import { userTeamSidebarFavorites } from '@/models'
import { sidebarDocumentRoutes } from '@/routes/sidebar-document'

import type { Collection } from 'mongodb'

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

export const sidebarFavoritesRoutes = sidebarDocumentRoutes({
  field: 'entries',
  collection: () => userTeamSidebarFavorites() as unknown as Collection,
  schema: replaceSchema,
  conflict: {
    code: 'sidebar_favorites_changed',
    message: 'Favorites changed concurrently; refresh and retry',
  },
})
