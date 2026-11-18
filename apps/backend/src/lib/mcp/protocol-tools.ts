import { CONTROL_TOOL_DEFINITIONS } from './protocol-tools-control'
import { MCP_SERVER_NAME } from './protocol-rpc'

// ─── Tool definitions (advertised via tools/list) ───────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'nuphos_ask',
    description:
      'Send a prompt to the Nuphos Agent and get its response. Blocks until the ' +
      'agent finishes. The agent keeps running in the background even if this ' +
      'call times out — reconnect with nuphos_check using the same session_id. ' +
      'Pass session_id back on a later call to continue a multi-turn conversation, ' +
      'or the session_id of an existing Task from nuphos_list_sessions to pick it up. ' +
      'A prompt sent while that session is running is handed to the turn in flight, ' +
      'which is how you add an instruction or change direction mid-run. ' +
      'Set wait to false to return as soon as the turn is accepted and poll ' +
      'nuphos_check instead. ' +
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
        wait: {
          type: 'boolean',
          description:
            'false returns once the turn is accepted, with status "running", ' +
            'instead of blocking until it ends. Default true. For a new session ' +
            'it waits up to 5 seconds for the session to be stored; if ' +
            'nuphos_check then says "Session not found", retry it shortly.',
        },
        runtime_id: {
          type: 'string',
          description:
            'The agent a NEW session runs on, from nuphos_list_runtimes. Omitted: ' +
            'your default agent in the team. An existing session keeps its own agent.',
        },
        model: {
          type: 'string',
          description:
            'The model a NEW session starts on; needs runtime_id. A model the agent does ' +
            "not offer is refused with its choices. Omitted: the agent's own default. " +
            'For an existing session use nuphos_update_session.',
        },
        effort: {
          type: 'string',
          description:
            'The reasoning effort a NEW session starts with, e.g. high; needs runtime_id, ' +
            'like model.',
        },
        request_id: {
          type: 'string',
          description:
            'Answer an open question of the session, from the requests that ' +
            'nuphos_check returns: prompt is then the answer, and the agent that ' +
            'asked carries on with it. Questions that ask for a secret or to ' +
            'connect an account are answered in Nuphos only.',
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
      'See where a session stands. status is "running" (with in_progress, what ' +
      'the turn has done so far), "waiting_for_input" (it stopped on the questions ' +
      'in requests; answer one with nuphos_ask request_id), "completed" (with the ' +
      'answer) or "failed". Use this after nuphos_ask times out, to follow a ' +
      'long-running request, or to read an existing Task: from_index returns a ' +
      'page of its transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The session_id from nuphos_ask or nuphos_list_sessions.',
        },
        from_index: {
          type: 'number',
          description:
            'Also return a page of the transcript from this message index, one ' +
            'line per message; pass the returned next_index to continue. 0 starts ' +
            'at the beginning.',
        },
        include_tool_details: {
          type: 'boolean',
          description:
            'Include tool inputs and outputs (clipped) in transcript and ' +
            'in_progress, for example test output. Default false.',
        },
      },
      required: ['session_id'],
    },
  },
  ...CONTROL_TOOL_DEFINITIONS,
  {
    name: 'nuphos_list_teams',
    description:
      'List the Nuphos teams you belong to. Pass a returned team_id to ' +
      "nuphos_ask to scope the agent to that team's cloud accounts and " +
      'resources.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nuphos_list_sessions',
    description:
      'List the Tasks (sessions) you can work with in a team, newest first: your ' +
      'own, or with scope "shared" those of teammates you take part in. Use it ' +
      'to find an existing Task by a word in its title or first message, and ' +
      'with waiting_for_input to see everything that waits for a person.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'The Nuphos team. See nuphos_list_teams.' },
        search: {
          type: 'string',
          description: 'Only sessions whose title or first message contains this.',
        },
        waiting_for_input: {
          type: 'boolean',
          description: 'true lists only sessions with an open question.',
        },
        scope: {
          type: 'string',
          enum: ['mine', 'shared'],
          description: 'mine (default): sessions you own. shared: sessions you joined.',
        },
        parent_session_id: {
          type: 'string',
          description:
            "Only the Tasks under this session: a Bot's Tasks (rows with bot: true " +
            "are Bots) or a Task's sub-agents, whoever started them.",
        },
        limit: { type: 'number', description: 'Max sessions, 1 to 30 (default 15).' },
        cursor: { type: 'string', description: 'next_cursor from the previous page.' },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'nuphos_update_session',
    description:
      'Change how a session you own runs: its model, its reasoning effort, or ' +
      'Full Access. With Full Access on, the agent runs commands without asking ' +
      'for approval, so turn it on only when the person you work for wants this ' +
      'session to run unattended. A model or effort its agent does not offer is ' +
      'refused with the choices. Applies from the next turn. A Task under a Bot ' +
      "runs in its Bot's permission mode (full_access_follows names it): change " +
      'Full Access on the Bot instead.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The session to change.' },
        model: { type: 'string', description: 'Model id, as its agent lists it.' },
        effort: { type: 'string', description: 'Reasoning effort, e.g. high.' },
        full_access: {
          type: 'boolean',
          description: 'true allows permission requests without asking; false asks again.',
        },
      },
      required: ['session_id'],
    },
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
      'session. Categories this tool has no parameter for, such as local devices, ' +
      'stay as they are. Ids must come from nuphos_list_credentials; any id you are not ' +
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
