export type BotImportTarget = { teamId: string; runtimeId: string; agentRuntime: string }
export type BotImportSetup = {
  key: string
  name: string
  instructions: string
  memories: string[]
  schedules: {
    key: string
    name: string
    prompt: string
    requestedEnabled: boolean
    timeZone: string
    schedule: { kind: 'cron'; expression: string } | { kind: 'interval'; seconds: number }
  }[]
  manualTasks: { name: string; prompt: string; reason: string }[]
}
export type BotImportPreview = {
  id: string
  running?: boolean
  digest: string
  target: Omit<BotImportTarget, 'teamId'>
  expiresAt: string
  avatars?: Record<string, string>
  selection?: Omit<BotImportSelection, 'scheduleActivationConfirmed'>
  manifest: {
    requirements?: { provider: string; required: boolean; reason: string }[]
    bots: (BotImportSetup & {
      avatar?: string
      skills: { key: string; directory: string }[]
      files: { path: string; destination: string }[]
    })[]
    chats: (BotImportSetup & { members: string[]; lead?: string })[]
  }
  items: {
    key: string
    kind: 'bot' | 'chat'
    sessionId: string
    privateChatId?: string
    state: 'pending' | 'applied' | 'failed'
    warnings: string[]
    error?: string
  }[]
}
export type BotImportSelection = {
  botKeys: string[]
  chatKeys: string[]
  enableSchedules: boolean
  scheduleActivationConfirmed: boolean
}

/** A template from the nuphos/bot-templates catalog, as the app shows it before a Bot is added. */
export type BotTemplate = {
  id: string
  version: string
  name: string
  author: string
  official: boolean
  featured: boolean
  category: string
  /** A built-in avatar file name; the app checks it before showing it. */
  avatar: string
  summary: string
  highlights: string[]
  examples: string[]
  integrations: { name: string; required: boolean; reason: string }[]
}
