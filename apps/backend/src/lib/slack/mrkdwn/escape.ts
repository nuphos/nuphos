// Slack-safe escaping for text that has already been parsed as CommonMark.
//
// Slack's escape syntax and CommonMark's entity syntax are the same three
// characters, which is where double-escaping comes from: escaping the `&` of an
// `&amp;` the author already wrote yields `&amp;amp;` — visible junk in prose,
// and a changed query string inside a URL. So an `&` that already opens a valid
// entity reference (named, decimal, or hex) is left alone and every other one
// is escaped. Slack decodes both forms back to the same character, so what the
// reader sees matches what the author wrote either way.
const BARE_AMPERSAND = /&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,8};|#[xX][0-9a-fA-F]{1,8};)/g

// Slack's own control sequences: mentions, channel references, and the special
// `<!here>` / `<!subteam^…>` family. They are already mrkdwn — escaping their
// angle brackets would turn a notifying mention into literal `&lt;@U…&gt;`.
// Only matched in text the parser reported as literal: a CommonMark-escaped
// `\<@U…>` arrives here as a separate escape token and is never seen whole.
const SLACK_TOKEN = /<[@#!][^<>\s|]+(?:\|[^<>]*)?>/g

// Schemes Slack renders as a link. Anything else (a bare `#anchor`, a relative
// path) stays literal text rather than becoming a broken link token.
const LINKABLE_SCHEME = /^(?:https?:\/\/|mailto:|tel:)/i

export function isSlackToken(value: string): boolean {
  const match = new RegExp(SLACK_TOKEN.source).exec(value)

  return match?.[0] === value
}

export function isLinkableUrl(url: string): boolean {
  return LINKABLE_SCHEME.test(url)
}

// Escapes every control character. Used where nothing may stay active: code
// content, CommonMark-escaped literals, and raw HTML.
export function escapeAll(text: string): string {
  return text.replace(BARE_AMPERSAND, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Code content is literal by definition, so entities are NOT preserved here:
// CommonMark shows `&amp;` inside code as those five characters, and only a
// fully escaped `&` reproduces that in Slack.
export function escapeCode(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Escapes prose while letting genuine Slack tokens through untouched.
export function escapeSlackText(text: string): string {
  const pattern = new RegExp(SLACK_TOKEN.source, 'g')
  let out = ''
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    out += escapeAll(text.slice(cursor, match.index)) + match[0]
    cursor = match.index + match[0].length
  }

  return out + escapeAll(text.slice(cursor))
}

// `|` and angle brackets terminate a Slack link token, so a destination
// carrying one would truncate the link. Percent-encoding keeps it resolvable.
export function escapeSlackUrl(url: string): string {
  return url
    .replace(BARE_AMPERSAND, '&amp;')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\|/g, '%7C')
}
