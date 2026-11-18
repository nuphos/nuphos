// Tools that drive a session as the app does: its agent, its live events, Stop and its queue.

export const CONTROL_TOOL_DEFINITIONS = [
  {
    name: 'nuphos_list_runtimes',
    description:
      "List the agents you can start a session on in a team: the team's agents and " +
      'your own computers. Pass a runtime_id with available true to nuphos_ask to ' +
      'start a new session there.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'The Nuphos team. See nuphos_list_teams.' },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'nuphos_events',
    description:
      "Read what a session's running turn streams (text, reasoning and tool events, " +
      'as the Nuphos app shows them live), after a cursor. Call without cursor to ' +
      'read the running turn from its start; pass the returned cursor to get only ' +
      'what came since, also after a reconnect; keep passing it and the next turn ' +
      'is picked up when it starts. Only the running turn is read: running false ' +
      'or turn_ended means the turn you were reading is over, and its answer and ' +
      'full record are in nuphos_check (from_index for the transcript).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The session to read.' },
        cursor: { type: 'string', description: 'cursor from the previous call.' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'nuphos_stop',
    description:
      "Stop the session's running turn, as the Stop button in Nuphos does. " +
      'You must be able to reply in the session.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'The session to stop.' } },
      required: ['session_id'],
    },
  },
  {
    name: 'nuphos_list_queue',
    description:
      'List the messages waiting to run in a session, in order. A message sent with ' +
      'nuphos_ask while a turn runs waits here until the agent takes it.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'The session.' } },
      required: ['session_id'],
    },
  },
  {
    name: 'nuphos_remove_queued',
    description:
      'Take back one of your own waiting messages, by queued_id from ' +
      'nuphos_list_queue, before the agent takes it. Only its sender can.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The session.' },
        queued_id: { type: 'string', description: 'queued_id from nuphos_list_queue.' },
      },
      required: ['session_id', 'queued_id'],
    },
  },
] as const
