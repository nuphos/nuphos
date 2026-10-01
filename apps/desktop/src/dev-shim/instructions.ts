import { call } from './http.ts'

import type { CreateInstructionInput, UpdateInstructionInput } from '../types/instructions'

function path(teamId: string, instructionId?: string): string {
  const base = `/teams/${encodeURIComponent(teamId)}/instructions`

  return instructionId ? `${base}/${encodeURIComponent(instructionId)}` : base
}

export function instructionsMethods() {
  return {
    atlasListInstructions: (teamId: string) => call('GET', path(teamId)),
    atlasCreateInstruction: (teamId: string, input: CreateInstructionInput) =>
      call('POST', path(teamId), input),
    atlasUpdateInstruction: (
      teamId: string,
      instructionId: string,
      input: UpdateInstructionInput,
    ) => call('PATCH', path(teamId, instructionId), input),
    atlasDeleteInstruction: (teamId: string, instructionId: string) =>
      call('DELETE', path(teamId, instructionId)),
  }
}
