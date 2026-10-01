import { isDirective } from './comment-utils.js'

const isDocBlock = (comment) =>
  comment.type === 'Block' && comment.value.startsWith('*') && !isDirective(comment)

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a doc comment immediately followed by another doc comment with no code between them.',
    },
    schema: [],
    messages: {
      orphaned:
        'This doc block documents nothing — another doc block follows it at line {{next}} with no code in between. Delete it, or move it above the code it describes.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode

    return {
      'Program:exit'() {
        const comments = sourceCode.getAllComments()
        // Anything above the first declaration describes the module, not a
        // symbol, so a second block below it orphans nothing. Imports do not
        // end that region: a file overview is routinely written under them.
        const firstDeclaration = sourceCode.ast.body.find(
          (node) => node.type !== 'ImportDeclaration',
        )
        const headerEnd = firstDeclaration ? firstDeclaration.range[0] : Number.POSITIVE_INFINITY

        for (let i = 0; i < comments.length - 1; i++) {
          const first = comments[i]
          const next = comments[i + 1]

          if (!isDocBlock(first) || !isDocBlock(next)) continue
          if (first.range[0] < headerEnd) continue

          const before = sourceCode.getTokenBefore(first, { includeComments: false })

          if (before !== sourceCode.getTokenBefore(next, { includeComments: false })) continue

          context.report({
            loc: first.loc,
            messageId: 'orphaned',
            data: { next: String(next.loc.start.line) },
          })
        }
      },
    }
  },
}
