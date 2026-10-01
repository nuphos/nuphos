import { z } from 'zod'

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i)
export const planNumberSchema = z.string().regex(/^[1-9]\d*$/)
export const teamPathSchema = z.object({ teamId: objectIdSchema })
export const connectionPathSchema = teamPathSchema.extend({ connectionId: objectIdSchema })
export const changePathSchema = connectionPathSchema.extend({
  changeId: z.union([objectIdSchema, planNumberSchema]),
})
