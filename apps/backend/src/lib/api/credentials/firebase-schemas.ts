import { z } from 'zod'

export const firebaseProjectSchema = z.object({
  projectId: z.string(),
  projectNumber: z.string(),
  displayName: z.string().optional(),
  state: z.string(),
})

export const firebaseAppsSchema = z.object({
  apps: z
    .array(
      z.object({
        appId: z.string(),
        displayName: z.string().optional(),
        platform: z.string(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
})
