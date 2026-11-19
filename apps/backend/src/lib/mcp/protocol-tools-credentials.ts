export const CREDENTIAL_TOOLS = [
  {
    name: 'nuphos_list_credentials',
    description:
      'List the credentials (GitHub installations, personal credentials, AWS roles, GCP service accounts, Linode/Hetzner ' +
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
      'Replace the cloud/service credentials a conversation may use: omitted or empty ' +
      'cloud/service lists revoke that category. GitHub installations, personal credentials ' +
      'and team identity instead keep their stored value when omitted; [] clears them. Categories this tool has no parameter for, such as local devices, ' +
      'stay as they are. Ids must come from nuphos_list_credentials; any id you are not ' +
      'allowed to use is filtered out by the same validator as the conversation picker. Takes effect on the next ' +
      'nuphos_ask in the session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The conversation to update.' },
        team_id: { type: 'string', description: 'The team the session belongs to.' },
        github_installation_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'GitHub installations to allow. Omit to keep the selection; [] denies all. An unstored selection allows all available installations.',
        },
        personal_credential_ids: {
          type: 'array',
          items: { type: 'string', enum: ['github', 'linear'] },
          description:
            'Standalone personal credentials owned by the caller. Omit to keep; [] clears.',
        },
        team_identity: {
          type: 'array',
          items: { type: 'string', enum: ['github', 'linear'] },
          description:
            'Use the team identity for these providers instead of preferring the caller’s personal identity. Omit to keep; [] restores personal preference with team fallback.',
        },
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
] as const
