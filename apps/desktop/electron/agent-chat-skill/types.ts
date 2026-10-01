export type AgentChatSkillTarget = 'claude' | 'codex'
export type AgentChatSkillId = 'open-in-nuphos' | 'get-short-lived-creds-from-nuphos'

export type AgentChatSkillInstallResult = {
  skillId: AgentChatSkillId
  target: AgentChatSkillTarget
  path: string
  operation: 'created' | 'updated'
}

export type AgentChatSkillUninstallResult = {
  skillId: AgentChatSkillId
  target: AgentChatSkillTarget
  path: string
  operation: 'removed'
}

export type AgentChatSkillStatus = {
  skillId: AgentChatSkillId
  skillName: string
  description: string
  target: AgentChatSkillTarget
  label: string
  path: string
  skillPath: string
  helperPath: string
  installed: boolean
  upToDate: boolean
  skillExists: boolean
  helperExists: boolean
  helperExecutable: boolean
}

export type SkillDefinition = {
  id: AgentChatSkillId
  name: string
  description: string
  helperName: string
  legacyName?: string
  legacyHelperName?: string
  skillBody: (target: AgentChatSkillTarget) => string
  helperScript: string
}
