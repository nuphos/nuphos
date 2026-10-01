import * as atlas from '../atlas'

import type { CreateInstructionInput, UpdateInstructionInput } from '../../src/types/instructions'

export const instructionsChannels = {
  'atlas:listInstructions': (_e: unknown, teamId: string) => atlas.listInstructions(teamId),
  'atlas:createInstruction': (_e: unknown, teamId: string, input: CreateInstructionInput) =>
    atlas.createInstruction(teamId, input),
  'atlas:updateInstruction': (
    _e: unknown,
    teamId: string,
    instructionId: string,
    input: UpdateInstructionInput,
  ) => atlas.updateInstruction(teamId, instructionId, input),
  'atlas:deleteInstruction': (_e: unknown, teamId: string, instructionId: string) =>
    atlas.deleteInstruction(teamId, instructionId),
}
