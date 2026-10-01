import type { CreateInstructionInput, UpdateInstructionInput } from '../types/instructions'

export const instructionsApi = {
  atlasListInstructions: (teamId: string) => window.api.atlasListInstructions(teamId),
  atlasCreateInstruction: (teamId: string, input: CreateInstructionInput) =>
    window.api.atlasCreateInstruction(teamId, input),
  atlasUpdateInstruction: (teamId: string, instructionId: string, input: UpdateInstructionInput) =>
    window.api.atlasUpdateInstruction(teamId, instructionId, input),
  atlasDeleteInstruction: (teamId: string, instructionId: string) =>
    window.api.atlasDeleteInstruction(teamId, instructionId),
}
