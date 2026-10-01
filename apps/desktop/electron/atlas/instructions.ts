import { call } from './client'

import type {
  CreateInstructionInput,
  Instruction,
  InstructionListing,
  UpdateInstructionInput,
} from '../../src/types/instructions'

function path(teamId: string, instructionId?: string): string {
  const base = `/teams/${encodeURIComponent(teamId)}/instructions`

  return instructionId ? `${base}/${encodeURIComponent(instructionId)}` : base
}

export function listInstructions(teamId: string): Promise<InstructionListing> {
  return call<InstructionListing>('GET', path(teamId))
}

export function createInstruction(
  teamId: string,
  input: CreateInstructionInput,
): Promise<Instruction> {
  return call<Instruction>('POST', path(teamId), input, { retry: false })
}

export function updateInstruction(
  teamId: string,
  instructionId: string,
  input: UpdateInstructionInput,
): Promise<Instruction> {
  return call<Instruction>('PATCH', path(teamId, instructionId), input, { retry: false })
}

export async function deleteInstruction(teamId: string, instructionId: string): Promise<void> {
  await call('DELETE', path(teamId, instructionId), undefined, { retry: false })
}
