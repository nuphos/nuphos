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
  /** The conversation whose dock the page opens in, instead of the one on screen. */
  session?: string
}

// Emitted when the user clicks the "agent finished" native notification. The
// window is already shown/focused by the main process; the renderer's job is
// to put the conversation that fired it back on screen.
export type AgentFocusSessionPayload = {
  sessionId: string
  teamId?: string
  /** A dock tab to bring forward too, by its workspace tab id. */
  dockTab?: string
}

export type AgentChatSkillTarget = 'claude' | 'codex'
export type AgentChatSkillId = 'open-in-nuphos'

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
  /** Where `path` resolves to when the skill's own entry is a link, else null. */
  linkedTo: string | null
  description: string | null
  /** What an import would upload; `outside` files come through a link out of the skill. */
  files: { relPath: string; realPath: string; size: number; outside: boolean }[]
  fileCount: number
  totalBytes: number
  updatedAt: string
}

/** One picked skill after Import from this computer; mirrors main's outcome. */
export type LocalSkillImportOutcome = {
  id: string
  name: string
  status: 'imported' | 'skipped' | 'failed'
  reason?: 'name_taken' | 'builtin' | 'changed' | 'missing' | 'error'
  message?: string
  keys: string[]
  /** Files the store would have rejected for size. */
  tooLarge: string[]
}

/** One "Sync my setup" pass: this computer's skill folders and CLAUDE.md, as personal ones. */
export type LocalSetupResult = {
  at: string
  syncedSkills: number
  uploadedFiles: number
  removedSkills: number
  skipped: {
    name: string
    reason:
      | 'too_large'
      | 'too_many_files'
      | 'name_taken'
      | 'over_budget'
      | 'unreadable'
      | 'needs_review'
      | 'name_clash'
    /** For `name_clash`: the folder whose copy stays here, and the earlier one that syncs. */
    folder?: string
    syncedFrom?: string
  }[]
  instruction: 'synced' | 'removed' | 'none' | 'too_long'
  instructionParts: number
  failed: string[]
  /** The folder each synced skill came from. */
  sources?: Record<string, string>
}

export type LocalSetupStatus = {
  autoSync: boolean
  running: boolean
  /** The folders synced, ~/.claude/skills first: a name in two goes from the first. */
  folders: { path: string; skills: number }[]
  /** Where Codex keeps its skills, offered as a folder to add. */
  codexFolder: string
  /** Skills linking outside their own folder: sync reads one only once reviewed. */
  linkedSkills: { name: string; files: LocalSkillInfo['files']; reviewed: boolean }[]
  claudeMdChars: number | null
  last: LocalSetupResult | null
  budget: { files: number; bytes: number }
}

export type PastedAttachmentPayload = {
  paths: string[]
  files: { name: string; type: string; bytes: ArrayBuffer }[]
}

// Workload kinds whose pod template can be restarted / edited in place.
export type ScalableWorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet'
