import { WEBHOOK_EVENTS } from '@/lib/webhooks/store'

export const WEBHOOK_TOOLS = [
  {
    name: 'nuphos_webhooks',
    description:
      "List, create, update, delete or test a team's webhooks, as Team settings → Webhooks " +
      'does. For sessions started by nuphos_ask with webhook_id set to a webhook, and ' +
      'their Tasks, Nuphos POSTs JSON to its https URL when a session finishes or fails a ' +
      'turn, needs input, or a Task reports. Team administrators only. Header values (e.g. ' +
      'Authorization: Bearer <key>) are stored encrypted and never returned. headers replaces ' +
      'the whole list on update, and a header given without a value keeps its stored one.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'update', 'delete', 'test'] },
        team_id: { type: 'string', description: 'The team. See nuphos_list_teams.' },
        webhook_id: {
          type: 'string',
          description: 'The webhook to update, delete or test, as list returns it.',
        },
        name: { type: 'string', description: 'Needed to create.' },
        url: {
          type: 'string',
          description: 'An https:// URL on a public address. Needed to create.',
        },
        events: {
          type: 'array',
          items: { type: 'string', enum: WEBHOOK_EVENTS },
          description: 'The events to send. Needed to create.',
        },
        headers: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, value: { type: 'string' } },
            required: ['name'],
          },
          description: 'Sent with every request.',
        },
        enabled: {
          type: 'boolean',
          description:
            'false pauses deliveries. true resumes them and clears why Nuphos switched it off.',
        },
      },
      required: ['action', 'team_id'],
    },
  },
] as const
