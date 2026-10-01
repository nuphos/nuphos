import { db } from '@/lib/db'

import type { Collection, ObjectId } from 'mongodb'

export type InstructionScope = 'team' | 'personal'

/**
 * A markdown snippet injected into every new conversation. Team snippets have
 * `userId: null`; personal snippets belong to one user within one team.
 */
export type AgentInstruction = {
  _id: ObjectId
  teamId: ObjectId
  scope: InstructionScope
  userId: string | null
  title: string
  content: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
}

export const agentInstructions = (): Collection<AgentInstruction> =>
  db().collection<AgentInstruction>('agent_instructions')
