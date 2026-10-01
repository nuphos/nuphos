import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { canManageTeamInstructions, INSTRUCTION_LIMITS } from '@/lib/instructions/schema'
import { parseObjectId } from '@/lib/objectid'
import { agentInstructions } from '@/models'

import type {
  CreateInstructionInput,
  InstructionActor,
  UpdateInstructionInput,
} from '@/lib/instructions/schema'
import type { AgentInstruction, InstructionScope } from '@/models'
import type { Filter } from 'mongodb'

export type SerializedInstruction = {
  id: string
  scope: InstructionScope
  title: string
  content: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
}

export type InstructionListing = {
  team: SerializedInstruction[]
  personal: SerializedInstruction[]
  canManageTeam: boolean
  limits: typeof INSTRUCTION_LIMITS
}

export function serializeInstruction(doc: AgentInstruction): SerializedInstruction {
  return {
    id: doc._id.toHexString(),
    scope: doc.scope,
    title: doc.title,
    content: doc.content,
    enabled: doc.enabled,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
  }
}

function scopeFilter(
  teamId: ObjectId,
  scope: InstructionScope,
  userId: string,
): Filter<AgentInstruction> {
  return scope === 'team'
    ? { teamId, scope: 'team', userId: null }
    : { teamId, scope: 'personal', userId }
}

export async function findScopeInstructions(
  teamId: ObjectId,
  scope: InstructionScope,
  userId: string,
): Promise<AgentInstruction[]> {
  return agentInstructions()
    .find(scopeFilter(teamId, scope, userId))
    .sort({ createdAt: 1, _id: 1 })
    .toArray()
}

function assertCanWrite(actor: InstructionActor, scope: InstructionScope): void {
  if (scope === 'team' && !canManageTeamInstructions(actor.role)) {
    throw new AppError(403, 'forbidden', 'Only team administrators can change team instructions')
  }
}

function assertWithinLimits(existing: AgentInstruction[], nextContent: string | null): void {
  if (nextContent === null) return
  const total = existing.reduce((sum, doc) => sum + doc.content.length, nextContent.length)

  if (total > INSTRUCTION_LIMITS.totalContentCharsPerScope) {
    throw new AppError(
      422,
      'instruction_limit_exceeded',
      `Instructions in this scope may total at most ${String(INSTRUCTION_LIMITS.totalContentCharsPerScope)} characters`,
    )
  }
}

async function findOwnedInstruction(
  actor: InstructionActor,
  id: string,
): Promise<AgentInstruction> {
  const teamId = parseObjectId(actor.teamId, 'teamId')
  const doc = await agentInstructions().findOne({ _id: parseObjectId(id, 'instructionId'), teamId })

  if (!doc || (doc.scope === 'personal' && doc.userId !== actor.userId)) {
    throw new AppError(404, 'instruction_not_found', 'Instruction not found')
  }

  return doc
}

export async function listInstructions(actor: InstructionActor): Promise<InstructionListing> {
  const teamId = parseObjectId(actor.teamId, 'teamId')
  const [team, personal] = await Promise.all([
    findScopeInstructions(teamId, 'team', actor.userId),
    findScopeInstructions(teamId, 'personal', actor.userId),
  ])

  return {
    team: team.map(serializeInstruction),
    personal: personal.map(serializeInstruction),
    canManageTeam: canManageTeamInstructions(actor.role),
    limits: INSTRUCTION_LIMITS,
  }
}

export async function createInstruction(
  actor: InstructionActor,
  input: CreateInstructionInput,
): Promise<SerializedInstruction> {
  assertCanWrite(actor, input.scope)
  const teamId = parseObjectId(actor.teamId, 'teamId')
  const existing = await findScopeInstructions(teamId, input.scope, actor.userId)

  if (existing.length >= INSTRUCTION_LIMITS.snippetsPerScope) {
    throw new AppError(
      422,
      'instruction_limit_exceeded',
      `At most ${String(INSTRUCTION_LIMITS.snippetsPerScope)} instructions are allowed in this scope`,
    )
  }
  assertWithinLimits(existing, input.content)
  const now = new Date()
  const doc: AgentInstruction = {
    _id: new ObjectId(),
    teamId,
    scope: input.scope,
    userId: input.scope === 'team' ? null : actor.userId,
    title: input.title,
    content: input.content,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  }

  await agentInstructions().insertOne(doc)

  return serializeInstruction(doc)
}

export async function updateInstruction(
  actor: InstructionActor,
  id: string,
  patch: UpdateInstructionInput,
): Promise<SerializedInstruction> {
  const current = await findOwnedInstruction(actor, id)

  assertCanWrite(actor, current.scope)
  if (patch.content !== undefined) {
    const siblings = await findScopeInstructions(current.teamId, current.scope, actor.userId)

    assertWithinLimits(
      siblings.filter((doc) => !doc._id.equals(current._id)),
      patch.content,
    )
  }
  const $set: Partial<AgentInstruction> = { updatedAt: new Date(), updatedBy: actor.userId }

  if (patch.title !== undefined) $set.title = patch.title
  if (patch.content !== undefined) $set.content = patch.content
  if (patch.enabled !== undefined) $set.enabled = patch.enabled
  const updated = await agentInstructions().findOneAndUpdate(
    { _id: current._id, teamId: current.teamId },
    { $set },
    { returnDocument: 'after' },
  )

  if (!updated) throw new AppError(404, 'instruction_not_found', 'Instruction not found')

  return serializeInstruction(updated)
}

export async function deleteInstruction(actor: InstructionActor, id: string): Promise<void> {
  const current = await findOwnedInstruction(actor, id)

  assertCanWrite(actor, current.scope)
  await agentInstructions().deleteOne({ _id: current._id, teamId: current.teamId })
}
