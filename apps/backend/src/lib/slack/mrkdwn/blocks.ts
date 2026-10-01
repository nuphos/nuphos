import { escapeAll, escapeCode, escapeSlackText, isSlackToken } from '@/lib/slack/mrkdwn/escape'
import { renderInline } from '@/lib/slack/mrkdwn/inline'

import type { InlineToken } from '@/lib/slack/mrkdwn/inline'

export type BlockToken = InlineToken & {
  ordered?: boolean
  start?: number | string
  items?: BlockToken[]
}

// Slack mrkdwn has no list syntax; a `-` stays a literal dash and reads as one.
// `•` is what Slack's own composer produces and what mobile renders as a list.
const BULLET = '• '
// Nesting is expressed by indentation, the only depth cue Slack keeps.
const NEST_INDENT = '  '

// Scanned rather than matched with `/\n*$/`: an end-anchored quantifier
// backtracks super-linearly, and block raws can be long.
function contentEnd(raw: string): number {
  let end = raw.length

  while (end > 0 && raw.charAt(end - 1) === '\n') end--

  return end
}

// Whatever whitespace this block consumed after its content. Re-emitting it
// verbatim is what preserves the author's paragraph and line boundaries — a
// fixed separator would insert blank lines the message never had.
function trailingNewlines(raw: string): string {
  return raw.slice(contentEnd(raw))
}

// Slack code blocks carry no language tag, so the info string is dropped; the
// content is fully escaped, which is also what makes a `<@U…>` an author wrote
// inside code inert instead of a live notification.
function renderCode(token: BlockToken): string {
  return `\`\`\`\n${escapeCode(token.text ?? '')}\n\`\`\``
}

function renderList(token: BlockToken, indent: string): string {
  const lines: string[] = []
  // marked reports `start` as a number for ordered lists and '' otherwise.
  let ordinal = typeof token.start === 'number' ? token.start : 1

  for (const item of token.items ?? []) {
    const marker = token.ordered ? `${String(ordinal++)}. ` : BULLET
    const children = item.tokens ?? []
    const nested = children.filter((child) => child.type === 'list')
    const head = children
      .filter((child) => child.type !== 'list')
      .map((child) =>
        child.type === 'text' && child.tokens
          ? renderInline(child.tokens)
          : renderBlocks([child]).trimEnd(),
      )
      .join('\n')

    lines.push(`${indent}${marker}${head}`)
    for (const sub of nested) lines.push(renderList(sub, indent + NEST_INDENT))
  }

  return lines.join('\n')
}

// Blocks that carry no nested block structure.
function renderLeafBlock(token: BlockToken): string | null {
  switch (token.type) {
    // Pure whitespace between blocks; its raw IS the separator.
    case 'space':
      return token.raw ?? ''
    case 'code':
      return renderCode(token)
    case 'hr':
      return '---'
    case 'text':
      return token.tokens ? renderInline(token.tokens) : escapeSlackText(token.text ?? '')
    case 'html': {
      const raw = (token.raw ?? '').trim()

      return isSlackToken(raw) ? raw : escapeAll(raw)
    }
    // A link reference definition renders nothing on its own.
    case 'def':
      return ''
    default:
      return null
  }
}

function renderBlockToken(token: BlockToken): string {
  const leaf = renderLeafBlock(token)

  if (leaf !== null) return leaf
  switch (token.type) {
    // Slack has no headings; bold is the closest thing that still reads as a
    // section break.
    case 'heading':
      return `*${renderInline(token.tokens)}*`
    case 'blockquote':
      return renderBlocks(token.tokens)
        .trimEnd()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'list':
      return renderList(token, '')
    case 'paragraph':
      return renderInline(token.tokens)
    // Slack renders no table markup, so the source rows are kept as escaped
    // text — readable, and never active.
    default: {
      const raw = token.raw ?? ''

      return escapeSlackText(raw.slice(0, contentEnd(raw)))
    }
  }
}

export function renderBlocks(tokens: BlockToken[] | undefined): string {
  let out = ''

  for (const token of tokens ?? []) {
    if (token.type === 'space') {
      out += token.raw ?? ''
      continue
    }
    out += renderBlockToken(token) + trailingNewlines(token.raw ?? '')
  }

  return out
}
