import { jsonSize } from './status'

import type { Message } from './model'
import type { ToolPart } from './parts'

export function localCommandToolTokenFor(lastMsg: Message | undefined): string {
  if (lastMsg?.role !== 'assistant') return ''

  return lastMsg.parts
    .filter(
      (part): part is ToolPart =>
        part.type === 'tool' && (part.toolName === 'local_exec' || part.toolName === 'bash'),
    )
    .map((part) =>
      [
        part.toolCallId,
        part.toolName,
        part.state,
        jsonSize(part.input),
        jsonSize(part.output),
        part.errorText?.length ?? 0,
      ].join(':'),
    )
    .join('|')
}

export function hasRunningToolFor(lastMsg: Message | undefined): boolean {
  if (lastMsg?.role !== 'assistant') return false

  return lastMsg.parts.some(
    (part) =>
      part.type === 'tool' &&
      part.toolName !== 'skill' &&
      (part.state === 'input-streaming' || part.state === 'input-available'),
  )
}

export function lastStreamTokenFor(lastMsg: Message | undefined): string {
  if (lastMsg?.role !== 'assistant') return lastMsg?.role ?? ''

  return lastMsg.parts
    .map((p) => {
      if (p.type === 'text') return `text:${String(p.text.length)}`
      if (p.type === 'tool') {
        return [
          'tool',
          p.toolCallId,
          p.toolName,
          p.state,
          jsonSize(p.input),
          jsonSize(p.output),
          p.errorText?.length ?? 0,
        ].join(':')
      }

      return p.type
    })
    .join('|')
}
