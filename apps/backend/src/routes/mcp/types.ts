import type { AgentClientMeta } from '@/lib/agent/db'

export type McpCallContext = {
  userId: string
  // Who is calling: the OAuth client registration (Claude Code, Codex, …) when
  // the caller came through the OAuth flow, else just the HTTP User-Agent.
  client?: AgentClientMeta
}
