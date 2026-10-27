import { ObjectId } from 'mongodb'

import {
  agentMemories,
  LIVE_RECORD_FILTER,
  memoryRecordAccessFilter,
  teamMemories,
} from './shared'

import type { AgentMemoryRecord, AgentTeamMemory } from '../types'

export async function getTeamMemory(
  teamId: string,
  memoryId: string,
): Promise<AgentTeamMemory | null> {
  if (!ObjectId.isValid(memoryId)) return null

  // Same visibility rule as searchTeamPlaybooks: a rejected or
  // superseded playbook must not be retrievable by remembered id (review).
  // Removed-items listing/restore in records-api use their own queries.
  return teamMemories().findOne({
    _id: new ObjectId(memoryId),
    teamId,
    status: { $in: ['active', 'needs_review'] },
  })
}

export async function getMemoryRecord(
  memoryId: string,
  userId: string,
  teamId: string | null | undefined,
): Promise<AgentMemoryRecord | null> {
  if (!ObjectId.isValid(memoryId)) return null

  return agentMemories().findOne({
    _id: new ObjectId(memoryId),
    ...memoryRecordAccessFilter(userId, teamId),
    ...LIVE_RECORD_FILTER,
  })
}
