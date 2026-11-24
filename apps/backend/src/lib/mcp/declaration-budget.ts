/** One tool as Antigravity measures it: the compact `{name, description, inputSchema}` JSON. */
export type McpToolDeclaration = {
  name: string
  description?: string
  inputSchema?: unknown
}

/**
 * Antigravity keeps one byte budget per session, shared by every MCP server and filled
 * smallest tool first. Anything past it is left out of the eager tool list with no error
 * (#4148). 32 KiB is the guard the nuphos-tools set already stays under.
 */
export const ANTIGRAVITY_DECLARATION_BUDGET = 32 * 1024

/**
 * Ceiling for the nuphos servers on Antigravity. It sits under the budget, so per-turn
 * text can grow without crossing it, and a custom server only fits in what remains.
 * The budget test fails when the real declaration grows past this ceiling.
 */
export const ANTIGRAVITY_NUPHOS_RESERVE = ANTIGRAVITY_DECLARATION_BUDGET - 512

export function declarationBytes(tools: readonly McpToolDeclaration[], instructions = ''): number {
  const toolsBytes = tools.reduce((sum, tool) => {
    return (
      sum +
      Buffer.byteLength(
        JSON.stringify({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }),
      )
    )
  }, 0)

  return toolsBytes + Buffer.byteLength(instructions)
}

/** True when `extraBytes` still fits beside the bytes the nuphos servers already occupy. */
export function customDeclarationFits(nuphosBytes: number, extraBytes: number): boolean {
  return nuphosBytes + extraBytes <= ANTIGRAVITY_NUPHOS_RESERVE
}

/** The notice block appended to a turn's system prompt. Empty when nothing was skipped. */
export function appendMcpServerNotices(
  prompt: string | undefined,
  notices: readonly string[],
): string | undefined {
  if (notices.length === 0) return prompt
  const block = ['## Custom MCP servers', '', ...notices.map((notice) => `- ${notice}`)].join('\n')

  return prompt ? `${prompt}\n\n${block}` : block
}
