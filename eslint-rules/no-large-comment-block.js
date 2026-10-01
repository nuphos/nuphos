import { classifyLines } from './comment-utils.js'

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow long contiguous blocks of comment-only lines. Code that needs an essay in front of it should be written more clearly instead.',
    },
    schema: [
      {
        type: 'object',
        properties: { max: { type: 'integer', minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        '{{count}} consecutive comment lines (limit {{max}}). Large comment blocks usually mean the code below needs to be clearer; decision history belongs in the pull request, not here.',
    },
  },

  create(context) {
    const max = context.options[0]?.max ?? 15
    const sourceCode = context.sourceCode
    const lines = classifyLines(sourceCode)

    return {
      'Program:exit'() {
        let start = 0
        let count = 0
        let last = 0

        const flush = () => {
          if (count > max) {
            context.report({
              loc: {
                start: { line: start, column: 0 },
                end: { line: last, column: sourceCode.lines[last - 1].length },
              },
              messageId: 'tooLong',
              data: { count: String(count), max: String(max) },
            })
          }
          start = 0
          count = 0
          last = 0
        }

        for (let line = 1; line <= lines.total; line++) {
          if (lines.commentOnly(line)) {
            if (count === 0) start = line
            count++
            last = line
          } else if (!lines.blank(line) || count === 0) {
            // A code-bearing line ends the run. A blank line only ends it when
            // no run is open, so blanks inside a block are passed over.
            flush()
          }
        }
        flush()
      },
    }
  },
}
