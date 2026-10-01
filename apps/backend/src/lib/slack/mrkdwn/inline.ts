import {
  escapeAll,
  escapeCode,
  escapeSlackText,
  escapeSlackUrl,
  isLinkableUrl,
  isSlackToken,
} from '@/lib/slack/mrkdwn/escape'

// Inline tokens as the walker needs them. marked's own union is narrower per
// type than the walk requires (nested `tokens` appear on several kinds, and the
// walk must also survive a token type it has never heard of), so this reads the
// fields structurally rather than discriminating on marked's union.
export type InlineToken = {
  type: string
  raw?: string
  text?: string
  href?: string
  tokens?: InlineToken[]
}

// Slack inline code takes single backticks, so content holding a backtick run
// needs a longer fence — the same rule CommonMark uses. Padding spaces are
// added when the content itself starts or ends with a backtick, which is the
// only way the delimiters stay unambiguous.
function renderCodeSpan(content: string): string {
  let longest = 0

  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  const fence = '`'.repeat(longest + 1)
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : ''

  return `${fence}${pad}${escapeCode(content)}${pad}${fence}`
}

// A link token covers three different sources, and only one of them is a
// CommonMark inline link:
//  - `<…>` raw: a CommonMark autolink, or a Slack `<url|label>` token the
//    author already wrote. Both are valid mrkdwn as-is.
//  - raw === href: a GFM bare-URL autolink. Slack links bare URLs itself, so
//    rewriting it would only add noise.
//  - anything else: `[label](url)` — the case that must become `<url|label>`.
function renderLink(token: InlineToken, label: string): string {
  const raw = token.raw ?? ''
  const href = token.href ?? ''

  if (raw.startsWith('<')) return raw
  if (raw === href) return escapeAll(raw)
  if (!isLinkableUrl(href)) return escapeSlackText(raw)
  const url = escapeSlackUrl(href)

  return label ? `<${url}|${label}>` : `<${url}>`
}

export function renderInline(tokens: InlineToken[] | undefined): string {
  return (tokens ?? []).map((token) => renderInlineToken(token)).join('')
}

// Tokens whose content is literal: nothing inside them is markup, so they only
// need the right flavour of escaping.
function renderLeafToken(token: InlineToken): string | null {
  switch (token.type) {
    // A CommonMark backslash escape: the author said "literal, not markup".
    // Slack has no backslash escape, so the backslash is dropped here and the
    // character is escaped where Slack allows it — which is what keeps a
    // `\<@U…>` from arriving as a live mention.
    case 'escape':
      return escapeAll(token.text ?? '')
    case 'text':
      return token.tokens ? renderInline(token.tokens) : escapeSlackText(token.text ?? '')
    // Raw HTML has no meaning in Slack. `<!here>` and friends land here when
    // they open a line, so a genuine Slack token passes; everything else is
    // neutralized rather than handed to Slack as active markup.
    case 'html': {
      const raw = (token.raw ?? '').trim()

      return isSlackToken(raw) ? raw : escapeAll(raw)
    }
    case 'codespan':
      return renderCodeSpan(token.text ?? '')
    case 'br':
      return '\n'
    default:
      return null
  }
}

function renderInlineToken(token: InlineToken): string {
  const leaf = renderLeafToken(token)

  if (leaf !== null) return leaf
  switch (token.type) {
    case 'strong':
      return `*${renderInline(token.tokens)}*`
    case 'em':
      return `_${renderInline(token.tokens)}_`
    case 'del':
      return `~${renderInline(token.tokens)}~`
    case 'link':
      return renderLink(token, renderInline(token.tokens))
    // Slack cannot inline a remote image from message text, so it degrades to
    // the same labelled link, using the alt text.
    case 'image':
      return renderLink(token, escapeSlackText(token.text ?? ''))
    default:
      return escapeSlackText(token.raw ?? '')
  }
}
