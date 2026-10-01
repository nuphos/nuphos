export type InstructionScope = 'team' | 'personal'

export type Instruction = {
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

export type InstructionLimits = {
  titleChars: number
  contentChars: number
  snippetsPerScope: number
  totalContentCharsPerScope: number
}

export type InstructionListing = {
  team: Instruction[]
  personal: Instruction[]
  canManageTeam: boolean
  limits: InstructionLimits
}

export type CreateInstructionInput = {
  scope: InstructionScope
  title: string
  content: string
  enabled?: boolean
}

export type UpdateInstructionInput = {
  title?: string
  content?: string
  enabled?: boolean
}
