/** Who archived or restored a conversation, and through what. */
export type ArchiveActor = {
  source:
    | 'user' // the owner, in the app, the CLI or the REST API
    | 'agent_run' // an agent run calling the REST API with its owner's run token
    | 'mcp' // an MCP client's archive tool
    | 'archive_thread' // an agent's archive_thread
    | 'create_thread' // a thread whose model pick was refused, hidden as it was made
    | 'auto_archive' // the idle sweep
    | 'turn' // a new turn brought it back
    | 'trigger' // a Trigger's turn brought it back
    | 'bot_left' // its Bot was made a Task again
    | 'chat_left' // its owner left the group chat alone in it
  userId?: string
  /** The agent session that did it for `userId`. */
  agentSessionId?: string
  /** The agent token (CLI or MCP) that did it for `userId`. */
  agentTokenId?: string
}

/** One archive or restore. `via` is the conversation whose own change moved this one with it. */
export type ArchiveChange = ArchiveActor & { archived: boolean; at: Date; via?: string }

// Enough to answer "who did this"; bounded so a busy conversation cannot grow without end.
const LIMIT = 50

const change = (archived: boolean, actor: ArchiveActor, via?: string): ArchiveChange => ({
  archived,
  at: new Date(),
  ...actor,
  ...(via ? { via } : {}),
})

/** `$push` that records one change, for an ordinary update. */
export const pushArchiveLog = (archived: boolean, actor: ArchiveActor, via?: string) => ({
  archiveLog: { $each: [change(archived, actor, via)], $slice: -LIMIT },
})

/** The same, as a `$set` value inside an update pipeline. */
export const appendArchiveLog = (archived: boolean, actor: ArchiveActor, via?: string) => ({
  $slice: [
    {
      $concatArrays: [
        { $ifNull: ['$archiveLog', []] },
        [{ $literal: change(archived, actor, via) }],
      ],
    },
    -LIMIT,
  ],
})
