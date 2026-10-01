import type {
  CreateInstructionInput,
  Instruction,
  InstructionListing,
  UpdateInstructionInput,
} from '../types/instructions'

export type WindowInstructionsApi = {
  atlasListInstructions(teamId: string): Promise<InstructionListing>
  atlasCreateInstruction(teamId: string, input: CreateInstructionInput): Promise<Instruction>
  atlasUpdateInstruction(
    teamId: string,
    instructionId: string,
    input: UpdateInstructionInput,
  ): Promise<Instruction>
  atlasDeleteInstruction(teamId: string, instructionId: string): Promise<void>
}
