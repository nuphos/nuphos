export type ApplyResourceIdentity = {
  apiVersion: string
  kind: string
  name: string
  namespace: string | null
}

export type AgentChatDeepLinkPayload = {
  prompt: string
  files: string[]
  cwd?: string
  source?: string
  teamId?: string
  autoSend: boolean
}

export type AppOpenDeepLinkPayload = {
  url: string
  path: string
}

// Emitted when the user clicks the "agent finished" native notification. The
// window is already shown/focused by the main process; the renderer's job is
// to put the conversation that fired it back on screen.
export type AgentFocusSessionPayload = {
  sessionId: string
  teamId?: string
}

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

export type LocalSessionSource = 'claude-code' | 'codex'

export type LocalAgentSessionInfo = {
  id: string
  source: LocalSessionSource
  path: string
  title: string
  subtitle: string
  updatedAt: string
}

/** Outcome of importing a local Claude Code / Codex session as a Nuphos
 *  conversation on a team agent. */
export type LocalSessionImportResult = {
  sessionId: string
  title: string
  messageCount: number
  /** Turns the import caps left out of the front of the transcript. */
  dropped: number
}

/** A skill directory this computer already has, in `~/.claude/skills` (claude)
 *  or `~/.agents/skills` (codex). */
export type LocalSkillInfo = {
  /** `<source>/<name>` — a name can exist under both agents. */
  id: string
  name: string
  source: 'claude' | 'codex'
  path: string
  description: string | null
  fileCount: number
  totalBytes: number
  updatedAt: string
}

export type LocalSkillImportResult = {
  name: string
  source: LocalSkillInfo['source']
  keys: string[]
  /** Files the team store would have rejected for size. */
  skipped: string[]
}

export type PastedAttachmentPayload = {
  paths: string[]
  files: { name: string; type: string; bytes: ArrayBuffer }[]
}

// Workload kinds whose pod template can be restarted / edited in place.
export type ScalableWorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet'
