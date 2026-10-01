import { ipcRenderer } from 'electron'

import type { CreateInstructionInput, UpdateInstructionInput } from '../../src/types/instructions'

export const instructionsApi = {
  atlasListInstructions: (teamId: string) => ipcRenderer.invoke('atlas:listInstructions', teamId),
  atlasCreateInstruction: (teamId: string, input: CreateInstructionInput) =>
    ipcRenderer.invoke('atlas:createInstruction', teamId, input),
  atlasUpdateInstruction: (teamId: string, instructionId: string, input: UpdateInstructionInput) =>
    ipcRenderer.invoke('atlas:updateInstruction', teamId, instructionId, input),
  atlasDeleteInstruction: (teamId: string, instructionId: string) =>
    ipcRenderer.invoke('atlas:deleteInstruction', teamId, instructionId),
}
