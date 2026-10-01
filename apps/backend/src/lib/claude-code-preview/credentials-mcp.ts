// The Claude Code runtime's credentials MCP surface: list what the
// conversation has selected, then fetch one value. The value fetch is injected
// as `vend` (an internal dispatch to the existing per-provider vending routes)
// so this module carries no authorization logic of its own — the routes' gate
// is the gate.
import { toolError, toolResult } from '@/lib/mcp/protocol'

import { listSelectedCredentials, listSessionCredentials } from './credential-listing'
import { mintPreviewMcpToken } from './mcp-token'
import { runtimeBackendUrl } from './runtime-backend-url'
import { mintRuntimeSkillsToken, runtimeSkillsUrl } from './runtime-skills-token'

import type { AcpHttpMcpServer } from './openab-acp-client'
import type { AgentRef } from '@/lib/agents/identity'
import type { McpSurface, ToolHandler } from '@/lib/mcp/protocol'

/**
 * The MCP servers attached to one conversation's Claude Code session: the
 * credentials surface and Nuphos's native tools, both on this backend. The
 * bearer is a short-lived token scoped to exactly this (session, team) mount —
 * never the user's general token, because the runtime endpoint it travels to
 * is team-admin-configurable. Empty when no sandbox-reachable base URL is
 * configured.
 */
// A runtime in this cluster reaches the backend Service directly — the public
// URL sits behind Cloudflare, whose 100s proxy timeout kills chunked decision
// waits and adds a pointless egress round-trip. A runtime elsewhere cannot
// resolve that name at all, so it is handed the public base instead.
export function previewMcpBaseUrl(external?: boolean, backendUrl?: string): string | undefined {
  return backendUrl ?? runtimeBackendUrl(external)
}

// The skill bundle's address and credential ride the session; the runtime runs
// its own sync from them.
function skillSyncEnv(teamId: string, base: string): Record<string, string> {
  return {
    NUPHOS_RUNTIME_SKILLS_URL: runtimeSkillsUrl(teamId, undefined, base),
    NUPHOS_RUNTIME_SKILLS_TOKEN: mintRuntimeSkillsToken(teamId),
  }
}

export function previewSessionEnv(args: {
  base: string
  mount: string
  token: string
  conversationId: string
  teamId: string
}): Record<string, string> {
  return {
    ...skillSyncEnv(args.teamId, args.base),
    // Native skills share the classic setup scripts. Give those scripts the
    // same variable names they already understand, but with the narrowly
    // scoped preview bearer rather than a user's general Nuphos token.
    NUPHOS_TOKEN: args.token,
    NUPHOS_BACKEND_URL: args.base,
    NUPHOS_SESSION_ID: args.conversationId,
    // Skills address team-scoped routes as /teams/$TEAM/...
    TEAM: args.teamId,
    NUPHOS_TEAM_ID: args.teamId,
    NUPHOS_PLAN_API_BASE: `${args.mount}/plans`,
    NUPHOS_PLAN_API_TOKEN: args.token,
  }
}

export function previewMcpServers(
  conversationId: string,
  teamId: string,
  userId: string,
  conversationOwnerUserId = userId,
  options?: PreviewSessionAccessOptions,
): AcpHttpMcpServer[] {
  return previewSessionAccess(conversationId, teamId, userId, conversationOwnerUserId, options)
    .mcpServers
}

export type PreviewSessionAccessOptions = { external?: boolean; backendUrl?: string }

export function previewSessionAccess(
  conversationId: string,
  teamId: string,
  userId: string,
  conversationOwnerUserId = userId,
  options?: PreviewSessionAccessOptions,
): { mcpServers: AcpHttpMcpServer[]; runtimeEnv?: Record<string, string> } {
  const base = previewMcpBaseUrl(options?.external, options?.backendUrl)

  if (!base || !userId) return { mcpServers: [] }
  const mount = `${base.endsWith('/') ? base.slice(0, -1) : base}/agent-sessions/${conversationId}/teams/${teamId}`
  const token = mintPreviewMcpToken({
    userId,
    conversationOwnerUserId,
    sessionId: conversationId,
    teamId,
    apiOrigin: base,
  })
  const headers = [{ name: 'Authorization', value: `Bearer ${token}` }]

  return {
    mcpServers: [
      { name: 'nuphos-credentials', type: 'http', url: `${mount}/mcp`, headers },
      { name: 'nuphos-tools', type: 'http', url: `${mount}/mcp-tools`, headers },
    ],
    runtimeEnv: previewSessionEnv({
      base,
      mount,
      token,
      conversationId,
      teamId,
    }),
  }
}

export const credentialsMcpServers = previewMcpServers

// Same contract as Claude Code's Bash tool: a one-line intent the chat UI
// shows as the tool card title. claude-agent-acp titles MCP calls by bare
// tool name, so this is the only way a credential call reads as a sentence.
const DESCRIPTION_PROPERTY = {
  type: 'string',
  description:
    'Clear, concise description of what this call is for, in 5-10 words, in ' +
    "the user's language. Shown to the user as the step title.",
}

export const CREDENTIALS_MCP_SURFACE: McpSurface = {
  serverName: 'nuphos-credentials',
  instructions:
    'Cloud credentials the user selected for this Nuphos conversation. Call ' +
    'list_credentials to see what is available, then get_credential with a ' +
    '(provider, id) pair from that list. Values are short-lived; fetch them ' +
    'right before use instead of storing them. Credential selection is per ' +
    'conversation: one bound to the team but not ticked here is listed under ' +
    '`notSelected` and cannot be fetched until the user ticks it.',
  toolDefinitions: [
    {
      name: 'list_credentials',
      description:
        'List the credentials selected for this conversation. Returns one entry ' +
        'per credential with its provider (aws, gcp, linode, hetzner, github, ' +
        'device, …), id, and a human-readable label. Entries with a `usage` ' +
        'note have no value for get_credential; follow the note instead. ' +
        '`notSelected` lists credentials the user may use that are bound to ' +
        'the team but not enabled for this conversation (`selected: false`); ' +
        'get_credential refuses them. When the task needs one, tell the user ' +
        'the exact label to tick in the credential picker instead of saying ' +
        'no credential exists. The selection is live — the user can change it ' +
        'mid-conversation.',
      inputSchema: { type: 'object', properties: { description: DESCRIPTION_PROPERTY } },
    },
    {
      name: 'get_credential',
      description:
        'Fetch the value of one selected credential — e.g. short-lived AWS STS ' +
        'keys or a GCP access token. Use the provider and id exactly as returned ' +
        'by list_credentials.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Provider key from list_credentials.' },
          id: { type: 'string', description: 'Credential id from list_credentials.' },
          description: DESCRIPTION_PROPERTY,
        },
        required: ['provider', 'id'],
      },
    },
  ],
}

/** Dispatches a vending-route suffix under the session's team mount. */
export type CredentialVend = (credentialPath: string) => Promise<{ status: number; body: string }>

export function credentialsMcpTools(
  agent: AgentRef,
  teamId: string,
  vend: CredentialVend,
): Record<string, ToolHandler> {
  return {
    list_credentials: async () => {
      const { selected, unselected } = await listSessionCredentials(agent, teamId)

      return toolResult({
        credentials: selected.map(({ credentialPath: _path, ...entry }) => entry),
        ...(unselected.length > 0 ? { notSelected: unselected } : {}),
      })
    },
    get_credential: async (args) => {
      const provider = typeof args.provider === 'string' ? args.provider : ''
      const id = typeof args.id === 'string' ? args.id : ''

      if (!provider || !id) return toolError('`provider` and `id` are required.')
      // Re-list on every fetch so a mid-conversation deselection revokes access
      // immediately, and so the vending path can never be caller-constructed.
      const entries = await listSelectedCredentials(agent, teamId)
      const entry = entries.find((item) => item.provider === provider && item.id === id)

      if (!entry) {
        return toolError(
          `No selected credential matches provider=${provider} id=${id}. ` +
            'Call list_credentials for the current selection; one listed under ' +
            '`notSelected` must be ticked by the user first.',
        )
      }

      if (!entry.credentialPath) {
        return toolError(`${provider} ${id} has no value to fetch. ${entry.usage ?? ''}`.trim())
      }

      const { status, body } = await vend(entry.credentialPath)

      if (status < 200 || status >= 300) {
        return toolError(`Credential fetch failed (${String(status)}): ${body}`)
      }

      let value: unknown = body

      try {
        value = JSON.parse(body)
      } catch {
        // Non-JSON vend responses are passed through as text.
      }

      return toolResult({ provider, id, label: entry.label, credential: value })
    },
  }
}
