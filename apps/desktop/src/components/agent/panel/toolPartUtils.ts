import { getToolInputDescription } from './model'

import type { ToolPart } from './parts'

export function getToolLabel(part: ToolPart): string {
  const description = getToolInputDescription(part.input)

  if (description) return description
  if (part.state === 'input-streaming') {
    if (part.toolName === 'bash' || part.toolName === 'local_exec') {
      return 'Preparing command…'
    }

    return 'Preparing tool…'
  }

  return part.toolName
}

export function getCommandFromInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const cmd = (input as Record<string, unknown>).command

  return typeof cmd === 'string' && cmd.length > 0 ? cmd : null
}

export function trimDisplayBlock(text: string): string {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  // Drop whole blank lines off both ends. A run of spaces on the last line is
  // not a line of its own, so it stays — that is what the indent pass measures.
  let first = 0

  while (first < all.length - 1 && all[first].trim().length === 0) first++
  let last = all.length

  while (last - 1 > first && all[last - 1].trim().length === 0) last--
  const lines = all.slice(first, last)
  const trimmed = lines.join('\n')
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0

  if (commonIndent <= 0) return trimmed

  return lines.map((line) => line.slice(commonIndent)).join('\n')
}

export function isCommandTool(part: ToolPart): boolean {
  return (
    (part.toolName === 'bash' || part.toolName === 'local_exec') &&
    getCommandFromInput(part.input) !== null
  )
}

export type CommandOutput = {
  stdout: string
  stderr: string
  exitCode: number | null
}

export function extractCommandOutput(output: unknown): CommandOutput {
  if (typeof output === 'string') {
    return { stdout: output, stderr: '', exitCode: null }
  }
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>

    return {
      stdout: typeof o.stdout === 'string' ? o.stdout : '',
      stderr: typeof o.stderr === 'string' ? o.stderr : '',
      exitCode: typeof o.exitCode === 'number' ? o.exitCode : null,
    }
  }

  return { stdout: '', stderr: '', exitCode: null }
}
