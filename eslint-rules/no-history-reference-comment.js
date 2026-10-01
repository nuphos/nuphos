import { isDirective } from './comment-utils.js'

const VALIDITY_WINDOW =
  /\b(?:through|until|till|thru|expires?|expiry|effective|valid|before|after|as of|starting|from)\s+$/i

const DATE = /\b20\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?\b/g
const ISSUE_REF = /\b(?:PR|MR|issue|pull request)\s*#\d+\b/i

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow citing tickets, pull requests, or dates in comments. Change history belongs in the pull request, reachable via git blame.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          ticketPrefixes: { type: 'array', items: { type: 'string' } },
          allowedPrefixes: { type: 'array', items: { type: 'string' } },
          flagIssueRefs: { type: 'boolean' },
          flagDates: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      ticket:
        'Comment cites ticket {{ref}}. Change history belongs in the pull request — git blame already leads there.',
      issue:
        'Comment cites {{ref}}. Change history belongs in the pull request — git blame already leads there.',
      date: 'Comment cites the date {{ref}}. Describe what the code does now; when it changed is in the pull request.',
    },
  },

  create(context) {
    const opts = context.options[0] ?? {}
    const ticketPrefixes = opts.ticketPrefixes ?? ['ZEA', 'NUPS', 'JIRA', 'LIN']
    const allowedPrefixes = opts.allowedPrefixes ?? ['ADR']
    const flagIssueRefs = opts.flagIssueRefs ?? true
    const flagDates = opts.flagDates ?? true

    const allowed = new Set(allowedPrefixes.map((p) => p.toUpperCase()))
    const banned = ticketPrefixes.filter((p) => !allowed.has(p.toUpperCase()))
    const ticketRe = banned.length > 0 ? new RegExp(`\\b(${banned.join('|')})-\\d+\\b`, 'gi') : null

    /** First marker in `text`, or null. One report per comment. */
    const findMarker = (text) => {
      if (ticketRe) {
        ticketRe.lastIndex = 0
        const hit = ticketRe.exec(text)

        if (hit) return { messageId: 'ticket', ref: hit[0] }
      }
      if (flagIssueRefs) {
        const hit = ISSUE_REF.exec(text)

        if (hit) return { messageId: 'issue', ref: hit[0] }
      }
      if (flagDates) {
        DATE.lastIndex = 0
        let hit

        while ((hit = DATE.exec(text)) !== null) {
          if (!VALIDITY_WINDOW.test(text.slice(0, hit.index))) {
            return { messageId: 'date', ref: hit[0] }
          }
        }
      }

      return null
    }

    return {
      'Program:exit'() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isDirective(comment)) continue
          const marker = findMarker(comment.value)

          if (marker) {
            context.report({
              loc: comment.loc,
              messageId: marker.messageId,
              data: { ref: marker.ref },
            })
          }
        }
      },
    }
  },
}
