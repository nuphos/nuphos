import { Lexer } from 'marked'

import { logEvent } from '@/lib/observability'
import { renderBlocks } from '@/lib/slack/mrkdwn/blocks'
import { escapeAll } from '@/lib/slack/mrkdwn/escape'

// Rewrites CommonMark — what the agent writes — into Slack mrkdwn, which is
// what `chat.postMessage` renders.
//
// The conversion runs off a real CommonMark token stream rather than a stack of
// delimiter regexes, because the things that have to be right are coupled:
// code delimiters are variable-length (backtick OR tilde, any run of 3+),
// backslash escapes decide whether `<@U…>` is a live mention or literal text,
// and entities inside a link destination must survive Slack escaping unchanged.
// A regex pipeline gets each of those individually and still loses on their
// combinations; the parser answers all of them once.
export function toSlackMrkdwn(markdown: string): string {
  if (typeof markdown !== 'string' || markdown.length === 0) return ''

  try {
    return renderBlocks(Lexer.lex(markdown))
    // Fails CLOSED. The block renderer recurses per nesting level, so a crafted
    // depth can exhaust the stack — and returning the raw input there would
    // hand Slack the very markup the happy path exists to neutralize. Once the
    // parse has failed there is no way to tell a genuine mention from an
    // escaped or code-fenced one, so everything is escaped: the message still
    // arrives and reads fine, it just cannot notify anyone.
  } catch (err) {
    logEvent('warn', 'slack.mrkdwn.convert_failed', {
      length: markdown.length,
      error: err instanceof Error ? err.message : String(err),
    })

    return escapeAll(markdown)
  }
}
