export type Conversation = {
  agentRuntime?: 'claude-code' | 'codex'
  runtimeId?: string
  runtimeLabel?: string
  sessionId: string
  teamId?: string
  title: string
  firstMessage: string
  messageCount: number
  activitySource?: {
    origin: 'nuphos' | 'slack' | 'trigger' | 'mcp' | 'unknown'
    linkedSlackThread: boolean
  }
  /** Set when a trigger fired this conversation: it is that Trigger's run,
   *  and is excluded from Chats. */
  triggerRun?: {
    id: string
    kind?: 'scheduled' | 'webhook' | 'manual' | 'alert'
    /** Watch group runs only — which monitored item fired behind the shared
     *  ingress the partition trigger serves. */
    memberKey?: string
  }
  isOwner?: boolean
  readOnly?: boolean
  owner?: {
    id: string
    name: string
    email: string
    avatarURL?: string
  }
  credentialAccess?: AgentCredentialAccess
  transcriptUpdatedAt?: string
  createdAt: string
  lastActiveAt: string
  activitySeq?: number
  readSeq?: number
}

export type AgentCredentialSelection = {
  awsRoleIds: string[]
  gcpServiceAccountIds: string[]
  linodeAccountIds: string[]
  hetznerAccountIds: string[]
  betterStackIntegrationIds: string[]
  tailscaleClientIds: string[]
  zeaburIds: string[]
}

export type AgentCredentialAccess = AgentCredentialSelection & {
  updatedAt?: string
  updatedBy?: string
}

export type AgentCredentialOptions = {
  awsRoles: {
    roleId: string
    accountId: string
    roleArn: string
  }[]
  gcpServiceAccounts: {
    serviceAccountId: string
    projectId: string
    serviceAccountEmail: string
  }[]
  linodeAccounts: {
    accountId: string
    label: string
  }[]
  hetznerAccounts: {
    accountId: string
    label: string
  }[]
  betterStackIntegrations: {
    integrationId: string
    label: string
    hasUptimeApiToken: boolean
    hasTelemetryApiToken: boolean
  }[]
  tailscaleClients: {
    clientId: string
    label: string
    oauthClientId: string
  }[]
  zeaburProviders: {
    zeaburId: string
    kind: 'user' | 'team'
    name: string
  }[]
}

export type AgentConversationCredentialsResponse = {
  credentialAccess: AgentCredentialAccess
  options: AgentCredentialOptions
}

export type ConversationsPage = {
  conversations: Conversation[]
  nextCursor: string | null
  hasMore: boolean
}

export type ConversationDetail = Conversation & {
  messages: {
    id: string
    role: 'user' | 'assistant'
    parts: unknown[]
  }[]
  /** Absolute transcript index of messages[0]; > 0 when a `tail` fetch cut off
   *  earlier messages (page backwards with getConversationMessages). */
  messagesFirstIndex?: number
}

export type ConversationMessagesPage = {
  messages: {
    id: string
    role: 'user' | 'assistant'
    parts: unknown[]
  }[]
  firstIndex: number
}
