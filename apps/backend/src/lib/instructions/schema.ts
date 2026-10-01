import { z } from 'zod'

import type { NuphosTeamRole } from '@/lib/identity'

export const INSTRUCTION_LIMITS = {
  titleChars: 120,
  contentChars: 8_000,
  snippetsPerScope: 20,
  totalContentCharsPerScope: 24_000,
} as const

export const instructionScopeSchema = z.enum(['team', 'personal'])

const titleSchema = z.string().trim().min(1).max(INSTRUCTION_LIMITS.titleChars)
const contentSchema = z.string().trim().min(1).max(INSTRUCTION_LIMITS.contentChars)

export const createInstructionSchema = z
  .object({
    scope: instructionScopeSchema,
    title: titleSchema,
    content: contentSchema,
    enabled: z.boolean().optional(),
  })
  .strict()

export const updateInstructionSchema = z
  .object({
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one of title, content, or enabled is required',
  })

export type CreateInstructionInput = z.infer<typeof createInstructionSchema>
export type UpdateInstructionInput = z.infer<typeof updateInstructionSchema>

export type InstructionActor = {
  teamId: string
  userId: string
  role: NuphosTeamRole
}

export function canManageTeamInstructions(role: NuphosTeamRole): boolean {
  return role === 'ADMINISTRATOR'
}
