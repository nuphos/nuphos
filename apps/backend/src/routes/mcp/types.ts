import type { AgentClientMeta } from '@/lib/agent/db'
import type { CliTokenPrincipal } from '@/lib/identity/cli-tokens'

export type McpCallContext = {
  userId: string
  // Who is calling: the OAuth client registration (Claude Code, Codex, …) when
  // the caller came through the OAuth flow, else just the HTTP User-Agent.
  client?: AgentClientMeta
  // The CLI token the caller signed in with. A run it starts gets this token, not a
  // new one for the person, so a Bot's run stays within the Bot's limits.
  cliToken?: { principal: CliTokenPrincipal; token: string }
}
