export const FILE_TOOLS = [
  {
    name: 'nuphos_files',
    description:
      'List screenshots, recordings, logs and other files a readable Task published through file-transfer, with short-lived download URLs. Fetch each ready file’s downloadUrl directly to download its bytes. Only ready, unexpired download groups are returned, newest first; this does not list arbitrary workspace files or render_artifact HTML. Call again to refresh expiring URLs. Reuses the existing transfer store.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The readable Task whose published files to retrieve.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
          description: 'Maximum number of transfer groups, newest first.',
        },
      },
      required: ['session_id'],
    },
  },
] as const
