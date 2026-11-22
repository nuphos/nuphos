export const RESOURCE_TOOLS = [
  {
    name: 'nuphos_find_pr_sessions',
    description:
      'Find the sessions bound to a GitHub pull request in one team. Returns only sessions the caller can read, including archived sessions. Bindings are explicit associations, not proof of PR authorship. An empty result means no readable binding was found. Follow next_cursor to read more.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'The team to search. See nuphos_list_teams.' },
        repository: {
          type: 'string',
          description: 'GitHub repository, owner/repo. Case insensitive.',
        },
        number: { type: 'integer', minimum: 1, description: 'The pull request number.' },
        cursor: { type: 'string', description: 'The next_cursor from the previous page.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['team_id', 'repository', 'number'],
    },
  },
] as const
