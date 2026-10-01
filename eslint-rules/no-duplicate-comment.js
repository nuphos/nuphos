import { isDirective, normalizeCommentText, wordCount } from './comment-utils.js'

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow repeating the same comment text many times within one file.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          max: { type: 'integer', minimum: 1 },
          minWords: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      repeated:
        'This comment is repeated {{count}} times in this file (first at line {{first}}). Say it once, or let the code say it.',
    },
  },

  create(context) {
    const max = context.options[0]?.max ?? 2
    const minWords = context.options[0]?.minWords ?? 4

    return {
      'Program:exit'() {
        const groups = new Map()

        for (const comment of context.sourceCode.getAllComments()) {
          if (isDirective(comment)) continue
          const key = normalizeCommentText(comment)

          if (wordCount(key) < minWords) continue
          const bucket = groups.get(key)

          if (bucket) bucket.push(comment)
          else groups.set(key, [comment])
        }

        for (const occurrences of groups.values()) {
          if (occurrences.length <= max) continue
          // Report every occurrence past the allowance rather than once for
          // the group, so each site carries its own fix and the problem count
          // reflects how far the duplication actually spread.
          for (const comment of occurrences.slice(max)) {
            context.report({
              loc: comment.loc,
              messageId: 'repeated',
              data: {
                count: String(occurrences.length),
                first: String(occurrences[0].loc.start.line),
              },
            })
          }
        }
      },
    }
  },
}
