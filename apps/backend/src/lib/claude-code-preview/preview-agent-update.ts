export type PreviewAgentUpdate =
  | { kind: 'thought'; text: string }
  | { kind: 'steering'; id: string; text: string }
  | {
      kind: 'runtime-state'
      snapshot: import('./runtime-execution-snapshot').SessionExecutionState
    }
  | {
      kind: 'tool'
      toolCallId: string
      title: string
      /** The raw `mcp__<server>__<tool>` id when the call is an MCP tool. */
      mcpToolId?: string
      status: string
      rawInput?: unknown
      rawOutput?: unknown
      contentText?: string
      /** Force the card into the stream even if it was hidden before. */
      revealed?: boolean
      /**
       * From a `ToolCallContent::Terminal` embed (`{type: 'terminal', terminalId}`)
       * on the raw ACP content array — correlates this chat-stream tool card with
       * its shells-panel entry. Live output/status/exit for that terminal ride the
       * `runtime-state` snapshot's `tools[].terminal` (openab#41), not this field.
       */
      terminalId?: string
    }

// ACP ToolCallContent: [{ type: 'content', content: { type: 'text', text } }, …]
export function extractToolContentText(content: unknown): string {
  if (!Array.isArray(content)) return ''

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const inner = (item as Record<string, unknown>).content

      if (!inner || typeof inner !== 'object') return ''
      const text = (inner as Record<string, unknown>).text

      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n')
}

// Raw Claude Code titles like "select:mcp__nuphos-credentials__get_credential"
// or "mcp__nuphos-credentials__list_credentials" read as noise in the chat;
// render them as "nuphos-credentials: list_credentials" instead.
export function prettifyToolTitle(title: string): string {
  const raw = title.startsWith('select:') ? title.slice('select:'.length) : title

  if (!raw.startsWith('mcp__')) return title
  const rest = raw.slice('mcp__'.length)
  const separator = rest.indexOf('__')

  if (separator <= 0) return title

  return `${rest.slice(0, separator)}: ${rest.slice(separator + 2)}`
}

// ACP ToolCallContent can carry a terminal embed alongside the usual text
// blocks: [{ type: 'terminal', terminalId }, …]. That id is what correlates
// this tool card with the shells-panel entry openab tracks under the same
// toolCallId in its runtime-state snapshot.
function extractTerminalId(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined

  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>

    if (entry.type === 'terminal' && typeof entry.terminalId === 'string' && entry.terminalId)
      return entry.terminalId
  }

  return undefined
}

// MCP calls carry their user-facing intent in the input; prefer it over the
// bare tool name.
function toolTitle(updatePayload: Record<string, unknown>): string {
  const raw = typeof updatePayload.title === 'string' ? updatePayload.title : ''
  const input = updatePayload.rawInput

  if (raw.startsWith('mcp__') && input && typeof input === 'object') {
    const fields = input as Record<string, unknown>
    // Credentials tools carry `description`; the adapted Nuphos tools keep
    // the classic `label` field. Either is the user-facing step title.
    const intent = fields.description ?? fields.label

    if (typeof intent === 'string' && intent.trim()) return intent.trim()
  }

  return prettifyToolTitle(raw)
}

/** Claude Code's deferred-tool lookups are plumbing, not steps the user took. */
export function isToolSearchTitle(title: string): boolean {
  return title.startsWith('select:')
}

const NUPHOS_TOOLS_PREFIX = 'mcp__nuphos-tools__'

/** The classic Nuphos tool name behind a `nuphos-tools` MCP call, else null. */
export function nuphosToolName(mcpToolId: string | undefined): string | null {
  return mcpToolId?.startsWith(NUPHOS_TOOLS_PREFIX)
    ? mcpToolId.slice(NUPHOS_TOOLS_PREFIX.length)
    : null
}

export function parseToolUpdate(
  toolCallId: string,
  updatePayload: Record<string, unknown>,
): PreviewAgentUpdate {
  const contentText = extractToolContentText(updatePayload.content)
  const terminalId = extractTerminalId(updatePayload.content)
  const rawTitle = typeof updatePayload.title === 'string' ? updatePayload.title : ''

  return {
    kind: 'tool',
    toolCallId,
    title: toolTitle(updatePayload),
    ...(rawTitle.startsWith('mcp__') ? { mcpToolId: rawTitle } : {}),
    status: typeof updatePayload.status === 'string' ? updatePayload.status : '',
    ...(updatePayload.rawInput === undefined ? {} : { rawInput: updatePayload.rawInput }),
    ...(updatePayload.rawOutput === undefined ? {} : { rawOutput: updatePayload.rawOutput }),
    ...(contentText ? { contentText } : {}),
    ...(terminalId ? { terminalId } : {}),
  }
}
