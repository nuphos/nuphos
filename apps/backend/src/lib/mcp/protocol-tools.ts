import { MCP_SERVER_NAME } from './protocol-rpc'

// ─── Tool definitions (advertised via tools/list) ───────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'nuphos_ask',
    description:
      'Send a prompt to the Nuphos Agent and get its response. Blocks until the ' +
      'agent finishes. The agent keeps running in the background even if this ' +
      'call times out — reconnect with nuphos_check using the same session_id. ' +
      'Pass session_id back on a later call to continue a multi-turn conversation. ' +
      'ALWAYS call nuphos_list_teams first: team_id is required, and every ' +
      'conversation runs inside one of your Nuphos teams.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The instruction or question for the Nuphos Agent.',
        },
        team_id: {
          type: 'string',
          description:
            "The Nuphos team to run in — required. Scopes the agent to that team's " +
            'cloud accounts and resources, and makes the conversation visible in ' +
            "that team's workspace. You must be a member of the team; call " +
            'nuphos_list_teams to discover your teams and their ids.',
        },
        session_id: {
          type: 'string',
          description:
            'Conversation handle. Provide your own id to enable reconnect after ' +
            'a timeout and to continue multi-turn; if omitted, one is generated ' +
            'and returned.',
        },
        context: {
          type: 'object',
          description:
            'Optional structured context the agent should consider (e.g. current ' +
            'repo, file paths, environment).',
          additionalProperties: true,
        },
      },
      required: ['prompt', 'team_id'],
    },
  },
  {
    name: 'nuphos_check',
    description:
      'Reconnect to a session to see whether the Nuphos Agent has finished. ' +
      'Returns the answer if it is done, or "running" if it is still working. ' +
      'Use this after nuphos_ask times out, or whenever you want to check on a ' +
      'long-running request.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The session_id you used with nuphos_ask.',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'nuphos_list_teams',
    description:
      'List the Nuphos teams you belong to. Pass a returned team_id to ' +
      "nuphos_ask to scope the agent to that team's cloud accounts and " +
      'resources.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nuphos_list_credentials',
    description:
      'List the cloud credentials (AWS roles, GCP service accounts, Linode/Hetzner ' +
      'accounts, Better Stack/Uptime Kuma/Jira/Asana/Sentry/Tailscale/Zeabur/Vanta/Secureframe/Resend integrations) ' +
      'you can use in a team. Pass session_id to also see which of them are ' +
      'currently enabled for that conversation. New conversations start with ALL ' +
      'listed credentials enabled EXCEPT Resend, which sends mail and must be ' +
      'enabled explicitly with nuphos_update_credentials; narrow the rest the same way.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: {
          type: 'string',
          description: 'The Nuphos team whose credentials to list. See nuphos_list_teams.',
        },
        session_id: {
          type: 'string',
          description:
            'Optional conversation to inspect — includes which credentials are ' +
            'currently enabled for it.',
        },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'nuphos_update_credentials',
    description:
      'Replace the set of credentials a conversation may use. FULL replacement: ' +
      'every id list you omit (or send empty) revokes that category for the ' +
      'session. Ids must come from nuphos_list_credentials; any id you are not ' +
      'allowed to use is rejected with an error. Takes effect on the next ' +
      'nuphos_ask in the session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The conversation to update.' },
        team_id: { type: 'string', description: 'The team the session belongs to.' },
        aws_role_ids: { type: 'array', items: { type: 'string' } },
        gcp_service_account_ids: { type: 'array', items: { type: 'string' } },
        linode_account_ids: { type: 'array', items: { type: 'string' } },
        hetzner_account_ids: { type: 'array', items: { type: 'string' } },
        betterstack_integration_ids: { type: 'array', items: { type: 'string' } },
        uptime_kuma_instance_ids: { type: 'array', items: { type: 'string' } },
        linear_workspace_ids: { type: 'array', items: { type: 'string' } },
        jira_site_ids: { type: 'array', items: { type: 'string' } },
        asana_account_ids: { type: 'array', items: { type: 'string' } },
        sentry_account_ids: { type: 'array', items: { type: 'string' } },
        tailscale_client_ids: { type: 'array', items: { type: 'string' } },
        zeabur_ids: { type: 'array', items: { type: 'string' } },
        vanta_integration_ids: { type: 'array', items: { type: 'string' } },
        secureframe_integration_ids: { type: 'array', items: { type: 'string' } },
        resend_integration_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['session_id', 'team_id'],
    },
  },
  {
    name: 'nuphos_capabilities',
    description:
      'Discover what the Nuphos Agent can do — supported task types and limits. ' +
      'Call this first if you are unsure whether Nuphos can handle a task.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const

export function getCapabilities(): unknown {
  return {
    agent: MCP_SERVER_NAME,
    description:
      'The Nuphos Agent provisions and operates cloud infrastructure on Nuphos: ' +
      'servers and Kubernetes clusters across BYOS providers (AWS, GCP, Tencent, ' +
      'Aliyun, Hetzner, Linode, Volcengine, …), inspecting and debugging ' +
      'deployments, and answering infrastructure questions.',
    supported_task_types: [
      'infrastructure-provisioning',
      'kubernetes-operations',
      'deployment-debugging',
      'cloud-account-management',
      'general-question',
    ],
    limits: {
      typical_latency_seconds: 30,
      note:
        'Long tasks continue running in the background even if nuphos_ask times ' +
        'out; reconnect with nuphos_check using the same session_id.',
    },
  }
}
